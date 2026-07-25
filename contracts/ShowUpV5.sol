// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract ShowUpV5 is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PAGE_SIZE = 50;
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant MAX_TITLE_BYTES = 320;
    uint256 public constant MAX_DESCRIPTION_BYTES = 960;
    uint256 public constant MAX_METADATA_URI_BYTES = 2048;
    uint256 public constant MAX_RESOLUTION_PERIOD = 7 days;

    bytes32 public constant INVITATION_TYPEHASH =
        keccak256(
            "Invitation(uint256 eventId,address attendee,uint256 nonce,uint256 expiry)"
        );

    IERC20 public immutable usdc;

    uint256 public eventCount;
    uint256 public totalEscrowed;

    enum EventType {
        Free,
        Paid
    }

    enum AccessMode {
        Public,
        InviteOnly
    }

    enum ReservationStatus {
        None,
        Reserved,
        Cancelled,
        Attended,
        NoShow,
        FallbackRefunded,
        EventCancelledRefunded,
        PaymentDue,
        Completed,
        PaymentDefaulted
    }

    struct EventDetails {
        address organizer;
        string title;
        string description;
        string metadataURI;
        EventType eventType;
        AccessMode accessMode;
        // Free event: refundable commitment deposit.
        // Paid event: upfront payment applied to totalPrice.
        uint256 depositAmount;
        // Must be zero for free events.
        uint256 totalPrice;
        // capacity == 0 means unlimited capacity.
        uint256 capacity;
        uint256 reservedSeats;
        uint256 escrowedAmount;
        uint64 cancellationDeadline;
        uint64 eventStart;
        uint64 eventEnd;
        uint64 resolutionDeadline;
        bool cancelled;
        // Paid events only. Deposit reservations must be fully paid by this time.
        uint64 paymentDeadline;
    }

    struct Reservation {
        ReservationStatus status;
        uint64 reservedAt;
        uint64 updatedAt;
        uint64 paymentDeadline;
    }

    mapping(uint256 => EventDetails) private _events;
    mapping(uint256 => mapping(address => Reservation)) private _reservations;
    mapping(uint256 => address[]) private _attendees;
    mapping(uint256 => mapping(address => bool)) private _attendeeListed;

    mapping(
        uint256 =>
            mapping(
                address =>
                    mapping(uint256 => bool)
            )
    ) private _usedInvitationNonces;

    mapping(
        uint256 =>
            mapping(
                address =>
                    mapping(uint256 => bool)
            )
    ) private _revokedInvitationNonces;

    error ZeroAddress();
    error EventNotFound();
    error NotOrganizer();
    error EventIsCancelled();
    error EventIsNotCancelled();
    error InvalidTitle();
    error TitleTooLong();
    error DescriptionTooLong();
    error InvalidMetadataURI();
    error MetadataURITooLong();
    error InvalidFreeEventPricing();
    error InvalidPaidEventPricing();
    error InvalidPaymentDeadline();
    error InvalidTimeline();
    error ResolutionPeriodTooLong();
    error EventHasStarted();
    error ReservationsClosed();
    error DepositReservationsClosed();
    error EventAtCapacity();
    error ReservationNotAvailable();
    error ReservationNotActive();
    error CancellationDeadlinePassed();
    error AttendanceWindowClosed();
    error NoShowWindowClosed();
    error ResolutionDeadlineNotReached();
    error PaymentNotDue();
    error PaymentWindowClosed();
    error PaymentDefaultWindowClosed();
    error InvalidPageLimit();
    error InvalidBatchSize();
    error PaidEventRequired();

    error OrganizerCannotReserve();
    error InvitationRequired();
    error InvitationNotRequired();
    error InvalidInvitation();
    error InvitationExpired();
    error InvitationAlreadyUsed();
    error InvitationAlreadyRevoked();

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        EventType eventType,
        AccessMode accessMode,
        string title,
        string metadataURI,
        uint256 depositAmount,
        uint256 totalPrice,
        uint256 capacity,
        uint64 paymentDeadline
    );

    event EventContentUpdated(
        uint256 indexed eventId,
        address indexed organizer,
        string title,
        string metadataURI
    );

    event SeatReserved(
        uint256 indexed eventId,
        address indexed attendee,
        EventType eventType,
        uint256 amountPaid,
        uint256 totalPrice,
        ReservationStatus newStatus
    );

    event ReservationCancelled(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 refundAmount
    );

    event AttendanceConfirmed(
        uint256 indexed eventId,
        address indexed attendee,
        ReservationStatus newStatus,
        uint256 attendeeRefund,
        uint256 organizerPayment,
        uint256 remainingBalance
    );

    event RemainingBalancePaid(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 amount
    );

    event NoShowSettled(
        uint256 indexed eventId,
        address indexed attendee,
        address indexed organizer,
        uint256 amount
    );

    event PaymentDefaulted(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 forfeitedDeposit,
        uint256 unpaidAmount
    );

    event FallbackRefundClaimed(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 refundAmount
    );

    event EventCancelled(
        uint256 indexed eventId,
        address indexed organizer
    );

    event CancelledEventRefundClaimed(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 refundAmount
    );

    event InvitationUsed(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 indexed nonce,
        uint256 expiry
    );

    event InvitationRevoked(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 indexed nonce
    );

    modifier eventExists(uint256 eventId) {
        if (_events[eventId].organizer == address(0)) {
            revert EventNotFound();
        }
        _;
    }

    modifier onlyOrganizer(uint256 eventId) {
        if (_events[eventId].organizer != msg.sender) {
            revert NotOrganizer();
        }
        _;
    }

    modifier eventActive(uint256 eventId) {
        if (_events[eventId].cancelled) {
            revert EventIsCancelled();
        }
        _;
    }

    constructor(address usdcAddress)
        EIP712("ShowUp", "5")
    {
        if (usdcAddress == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC20(usdcAddress);
    }

    function createEvent(
        string calldata title,
        string calldata description,
        string calldata metadataURI,
        EventType eventType,
        AccessMode accessMode,
        uint256 depositAmount,
        uint256 totalPrice,
        uint256 capacity,
        uint64 cancellationDeadline,
        uint64 eventStart,
        uint64 eventEnd,
        uint64 resolutionDeadline,
        uint64 paymentDeadline
    ) external returns (uint256 eventId) {
        _validateEventContent(title, description, metadataURI);
        _validatePricing(eventType, depositAmount, totalPrice);
        _validatePaymentDeadline(eventType, paymentDeadline, eventStart);

        if (
            eventType == EventType.Paid &&
            paymentDeadline != 0 &&
            cancellationDeadline > paymentDeadline
        ) {
            revert InvalidTimeline();
        }

        bool validTimeline =
            block.timestamp < cancellationDeadline &&
            cancellationDeadline < eventStart &&
            eventStart < eventEnd &&
            eventEnd < resolutionDeadline;

        if (!validTimeline) {
            revert InvalidTimeline();
        }

        if (uint256(resolutionDeadline) - uint256(eventEnd) > MAX_RESOLUTION_PERIOD) {
            revert ResolutionPeriodTooLong();
        }

        eventId = ++eventCount;

        _events[eventId] = EventDetails({
            organizer: msg.sender,
            title: title,
            description: description,
            metadataURI: metadataURI,
            eventType: eventType,
            accessMode: accessMode,
            depositAmount: depositAmount,
            totalPrice: totalPrice,
            capacity: capacity,
            reservedSeats: 0,
            escrowedAmount: 0,
            cancellationDeadline: cancellationDeadline,
            eventStart: eventStart,
            eventEnd: eventEnd,
            resolutionDeadline: resolutionDeadline,
            cancelled: false,
            paymentDeadline: paymentDeadline
        });

        emit EventCreated(
            eventId,
            msg.sender,
            eventType,
            accessMode,
            title,
            metadataURI,
            depositAmount,
            totalPrice,
            capacity,
            paymentDeadline
        );
    }

    function updateEventContent(
        uint256 eventId,
        string calldata title,
        string calldata description,
        string calldata metadataURI
    )
        external
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];

        if (block.timestamp >= eventDetails.eventStart) {
            revert EventHasStarted();
        }

        _validateEventContent(title, description, metadataURI);

        eventDetails.title = title;
        eventDetails.description = description;
        eventDetails.metadataURI = metadataURI;

        emit EventContentUpdated(eventId, msg.sender, title, metadataURI);
    }

    function reserveSeat(uint256 eventId)
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (
            eventDetails.accessMode !=
            AccessMode.Public
        ) {
            revert InvitationRequired();
        }

        _reserveSeat(
            eventId,
            msg.sender,
            eventDetails
        );
    }

    function reserveSeatWithInvitation(
        uint256 eventId,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    )
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        _consumeInvitation(
            eventId,
            msg.sender,
            nonce,
            expiry,
            signature,
            eventDetails
        );

        _reserveSeat(
            eventId,
            msg.sender,
            eventDetails
        );
    }

    function reserveSeatAndPayFull(uint256 eventId)
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (
            eventDetails.accessMode !=
            AccessMode.Public
        ) {
            revert InvitationRequired();
        }

        _reserveSeatAndPayFull(
            eventId,
            msg.sender,
            eventDetails
        );
    }

    function reserveSeatAndPayFullWithInvitation(
        uint256 eventId,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    )
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        _consumeInvitation(
            eventId,
            msg.sender,
            nonce,
            expiry,
            signature,
            eventDetails
        );

        _reserveSeatAndPayFull(
            eventId,
            msg.sender,
            eventDetails
        );
    }

    function payRemainingBalance(uint256 eventId)
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];
        Reservation storage reservation = _reservations[eventId][msg.sender];

        if (reservation.status != ReservationStatus.PaymentDue) {
            revert PaymentNotDue();
        }

        if (block.timestamp > eventDetails.paymentDeadline) {
            revert PaymentWindowClosed();
        }

        uint256 remainingBalance =
            eventDetails.totalPrice - eventDetails.depositAmount;

        reservation.status = ReservationStatus.Completed;
        reservation.updatedAt = uint64(block.timestamp);
        reservation.paymentDeadline = 0;

        _addEscrow(eventDetails, remainingBalance);

        usdc.safeTransferFrom(
            msg.sender,
            address(this),
            remainingBalance
        );

        emit RemainingBalancePaid(eventId, msg.sender, remainingBalance);
    }

    function cancelReservation(uint256 eventId)
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];

        if (block.timestamp > eventDetails.cancellationDeadline) {
            revert CancellationDeadlinePassed();
        }

        Reservation storage reservation = _reservations[eventId][msg.sender];
        uint256 refundAmount = _activeReservationEscrow(
            eventDetails,
            reservation.status
        );

        if (refundAmount == type(uint256).max) {
            revert ReservationNotActive();
        }

        reservation.status = ReservationStatus.Cancelled;
        reservation.updatedAt = uint64(block.timestamp);
        reservation.paymentDeadline = 0;

        eventDetails.reservedSeats -= 1;

        if (refundAmount != 0) {
            _consumeEscrow(eventDetails, refundAmount);
            usdc.safeTransfer(msg.sender, refundAmount);
        }

        emit ReservationCancelled(eventId, msg.sender, refundAmount);
    }

    function confirmAttendance(uint256 eventId, address attendee)
        external
        nonReentrant
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];
        _requireAttendanceWindow(eventDetails);

        uint256 organizerPayment = _confirmAttendance(
            eventId,
            attendee,
            eventDetails
        );

        if (organizerPayment != 0) {
            usdc.safeTransfer(eventDetails.organizer, organizerPayment);
        }
    }

    function batchConfirmAttendance(
        uint256 eventId,
        address[] calldata attendees
    )
        external
        nonReentrant
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        _validateBatchSize(attendees.length);

        EventDetails storage eventDetails = _events[eventId];
        _requireAttendanceWindow(eventDetails);

        uint256 organizerPayment;

        for (uint256 index = 0; index < attendees.length; index++) {
            organizerPayment += _confirmAttendance(
                eventId,
                attendees[index],
                eventDetails
            );
        }

        if (organizerPayment != 0) {
            usdc.safeTransfer(eventDetails.organizer, organizerPayment);
        }
    }

    function settleNoShow(uint256 eventId, address attendee)
        external
        nonReentrant
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];
        _requireNoShowWindow(eventDetails);

        uint256 amount = _markNoShow(eventId, attendee, eventDetails);

        if (amount != 0) {
            usdc.safeTransfer(eventDetails.organizer, amount);
        }
    }

    function batchSettleNoShow(
        uint256 eventId,
        address[] calldata attendees
    )
        external
        nonReentrant
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        _validateBatchSize(attendees.length);

        EventDetails storage eventDetails = _events[eventId];
        _requireNoShowWindow(eventDetails);

        uint256 totalAmount;

        for (uint256 index = 0; index < attendees.length; index++) {
            totalAmount += _markNoShow(
                eventId,
                attendees[index],
                eventDetails
            );
        }

        if (totalAmount != 0) {
            usdc.safeTransfer(eventDetails.organizer, totalAmount);
        }
    }

    function markPaymentDefault(uint256 eventId, address attendee)
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];
        Reservation storage reservation = _reservations[eventId][attendee];

        if (reservation.status != ReservationStatus.PaymentDue) {
            revert PaymentNotDue();
        }

        if (block.timestamp <= eventDetails.paymentDeadline) {
            revert PaymentDefaultWindowClosed();
        }

        reservation.status = ReservationStatus.PaymentDefaulted;
        reservation.updatedAt = uint64(block.timestamp);
        reservation.paymentDeadline = 0;

        eventDetails.reservedSeats -= 1;

        uint256 forfeitedDeposit = eventDetails.depositAmount;

        if (forfeitedDeposit != 0) {
            _consumeEscrow(eventDetails, forfeitedDeposit);
            usdc.safeTransfer(eventDetails.organizer, forfeitedDeposit);
        }

        emit PaymentDefaulted(
            eventId,
            attendee,
            forfeitedDeposit,
            eventDetails.totalPrice - eventDetails.depositAmount
        );
    }

    function claimFallbackRefund(uint256 eventId)
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];

        if (block.timestamp <= eventDetails.resolutionDeadline) {
            revert ResolutionDeadlineNotReached();
        }

        Reservation storage reservation = _reservations[eventId][msg.sender];
        uint256 refundAmount = _activeReservationEscrow(
            eventDetails,
            reservation.status
        );

        if (refundAmount == type(uint256).max) {
            revert ReservationNotActive();
        }

        reservation.status = ReservationStatus.FallbackRefunded;
        reservation.updatedAt = uint64(block.timestamp);
        reservation.paymentDeadline = 0;

        if (refundAmount != 0) {
            _consumeEscrow(eventDetails, refundAmount);
            usdc.safeTransfer(msg.sender, refundAmount);
        }

        emit FallbackRefundClaimed(eventId, msg.sender, refundAmount);
    }

    function cancelEvent(uint256 eventId)
        external
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];

        if (block.timestamp >= eventDetails.eventStart) {
            revert EventHasStarted();
        }

        eventDetails.cancelled = true;

        emit EventCancelled(eventId, msg.sender);
    }

    function claimCancelledEventRefund(uint256 eventId)
        external
        nonReentrant
        eventExists(eventId)
    {
        EventDetails storage eventDetails = _events[eventId];

        if (!eventDetails.cancelled) {
            revert EventIsNotCancelled();
        }

        Reservation storage reservation = _reservations[eventId][msg.sender];
        uint256 refundAmount = _activeReservationEscrow(
            eventDetails,
            reservation.status
        );

        if (refundAmount == type(uint256).max) {
            revert ReservationNotActive();
        }

        reservation.status = ReservationStatus.EventCancelledRefunded;
        reservation.updatedAt = uint64(block.timestamp);
        reservation.paymentDeadline = 0;

        if (refundAmount != 0) {
            _consumeEscrow(eventDetails, refundAmount);
            usdc.safeTransfer(msg.sender, refundAmount);
        }

        emit CancelledEventRefundClaimed(
            eventId,
            msg.sender,
            refundAmount
        );
    }

    function revokeInvitation(
        uint256 eventId,
        address attendee,
        uint256 nonce
    )
        external
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (
            eventDetails.accessMode !=
            AccessMode.InviteOnly
        ) {
            revert InvitationNotRequired();
        }

        if (attendee == address(0)) {
            revert ZeroAddress();
        }

        if (
            block.timestamp >=
            eventDetails.eventStart
        ) {
            revert EventHasStarted();
        }

        if (
            _usedInvitationNonces[
                eventId
            ][attendee][nonce]
        ) {
            revert InvitationAlreadyUsed();
        }

        if (
            _revokedInvitationNonces[
                eventId
            ][attendee][nonce]
        ) {
            revert InvitationAlreadyRevoked();
        }

        _revokedInvitationNonces[
            eventId
        ][attendee][nonce] = true;

        emit InvitationRevoked(
            eventId,
            attendee,
            nonce
        );
    }

    function hashInvitation(
        uint256 eventId,
        address attendee,
        uint256 nonce,
        uint256 expiry
    )
        external
        view
        eventExists(eventId)
        returns (bytes32)
    {
        return _invitationDigest(
            eventId,
            attendee,
            nonce,
            expiry
        );
    }

    function getInvitationState(
        uint256 eventId,
        address attendee,
        uint256 nonce
    )
        external
        view
        eventExists(eventId)
        returns (
            bool used,
            bool revoked
        )
    {
        used =
            _usedInvitationNonces[
                eventId
            ][attendee][nonce];

        revoked =
            _revokedInvitationNonces[
                eventId
            ][attendee][nonce];
    }

    function getEvent(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (EventDetails memory)
    {
        return _events[eventId];
    }

    function getEventMetadataURI(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (string memory)
    {
        return _events[eventId].metadataURI;
    }

    function getReservation(uint256 eventId, address attendee)
        external
        view
        eventExists(eventId)
        returns (Reservation memory)
    {
        return _reservations[eventId][attendee];
    }

    function getRemainingBalance(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (uint256)
    {
        EventDetails storage eventDetails = _events[eventId];

        if (eventDetails.eventType == EventType.Free) {
            return 0;
        }

        return eventDetails.totalPrice - eventDetails.depositAmount;
    }

    function getAttendeeCount(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (uint256)
    {
        return _attendees[eventId].length;
    }

    function getCapacityState(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (bool unlimited, uint256 remaining)
    {
        EventDetails storage eventDetails = _events[eventId];

        unlimited = eventDetails.capacity == 0;

        if (unlimited) {
            return (true, 0);
        }

        remaining = eventDetails.capacity - eventDetails.reservedSeats;
    }

    function getAttendees(
        uint256 eventId,
        uint256 offset,
        uint256 limit
    )
        external
        view
        eventExists(eventId)
        returns (address[] memory attendees)
    {
        if (limit == 0 || limit > MAX_PAGE_SIZE) {
            revert InvalidPageLimit();
        }

        uint256 totalAttendees = _attendees[eventId].length;

        if (offset >= totalAttendees) {
            return new address[](0);
        }

        uint256 end = offset + limit;

        if (end > totalAttendees) {
            end = totalAttendees;
        }

        attendees = new address[](end - offset);

        for (uint256 index = offset; index < end; index++) {
            attendees[index - offset] = _attendees[eventId][index];
        }
    }

    function _reserveSeat(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private {
        _requireReservationAvailable(
            eventId,
            attendee,
            eventDetails
        );

        ReservationStatus newStatus =
            ReservationStatus.Reserved;

        uint64 paymentDeadline;

        if (
            eventDetails.eventType ==
            EventType.Paid
        ) {
            if (
                eventDetails.paymentDeadline == 0 ||
                block.timestamp >
                eventDetails.paymentDeadline
            ) {
                revert DepositReservationsClosed();
            }

            newStatus =
                ReservationStatus.PaymentDue;

            paymentDeadline =
                eventDetails.paymentDeadline;
        }

        Reservation storage reservation =
            _reservations[eventId][attendee];

        reservation.status = newStatus;
        reservation.reservedAt =
            uint64(block.timestamp);
        reservation.updatedAt =
            uint64(block.timestamp);
        reservation.paymentDeadline =
            paymentDeadline;

        eventDetails.reservedSeats += 1;

        _listAttendee(eventId, attendee);

        if (eventDetails.depositAmount != 0) {
            _addEscrow(
                eventDetails,
                eventDetails.depositAmount
            );

            usdc.safeTransferFrom(
                attendee,
                address(this),
                eventDetails.depositAmount
            );
        }

        emit SeatReserved(
            eventId,
            attendee,
            eventDetails.eventType,
            eventDetails.depositAmount,
            eventDetails.totalPrice,
            newStatus
        );
    }

    function _reserveSeatAndPayFull(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private {
        if (
            eventDetails.eventType !=
            EventType.Paid
        ) {
            revert PaidEventRequired();
        }

        _requireReservationAvailable(
            eventId,
            attendee,
            eventDetails
        );

        Reservation storage reservation =
            _reservations[eventId][attendee];

        reservation.status =
            ReservationStatus.Completed;

        reservation.reservedAt =
            uint64(block.timestamp);

        reservation.updatedAt =
            uint64(block.timestamp);

        reservation.paymentDeadline = 0;

        eventDetails.reservedSeats += 1;

        _listAttendee(eventId, attendee);

        _addEscrow(
            eventDetails,
            eventDetails.totalPrice
        );

        usdc.safeTransferFrom(
            attendee,
            address(this),
            eventDetails.totalPrice
        );

        emit SeatReserved(
            eventId,
            attendee,
            eventDetails.eventType,
            eventDetails.totalPrice,
            eventDetails.totalPrice,
            ReservationStatus.Completed
        );
    }

    function _consumeInvitation(
        uint256 eventId,
        address attendee,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature,
        EventDetails storage eventDetails
    ) private {
        if (
            eventDetails.accessMode !=
            AccessMode.InviteOnly
        ) {
            revert InvitationNotRequired();
        }

        if (block.timestamp >= expiry) {
            revert InvitationExpired();
        }

        if (
            _usedInvitationNonces[
                eventId
            ][attendee][nonce]
        ) {
            revert InvitationAlreadyUsed();
        }

        if (
            _revokedInvitationNonces[
                eventId
            ][attendee][nonce]
        ) {
            revert InvitationAlreadyRevoked();
        }

        bytes32 digest =
            _invitationDigest(
                eventId,
                attendee,
                nonce,
                expiry
            );

        bool validSignature =
            SignatureChecker
                .isValidSignatureNow(
                    eventDetails.organizer,
                    digest,
                    signature
                );

        if (!validSignature) {
            revert InvalidInvitation();
        }

        _usedInvitationNonces[
            eventId
        ][attendee][nonce] = true;

        emit InvitationUsed(
            eventId,
            attendee,
            nonce,
            expiry
        );
    }

    function _invitationDigest(
        uint256 eventId,
        address attendee,
        uint256 nonce,
        uint256 expiry
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INVITATION_TYPEHASH,
                eventId,
                attendee,
                nonce,
                expiry
            )
        );

        return _hashTypedDataV4(structHash);
    }

    function _validateEventContent(
        string calldata title,
        string calldata description,
        string calldata metadataURI
    ) private pure {
        uint256 titleLength = bytes(title).length;
        uint256 descriptionLength = bytes(description).length;
        uint256 metadataLength = bytes(metadataURI).length;

        if (titleLength == 0) {
            revert InvalidTitle();
        }

        if (titleLength > MAX_TITLE_BYTES) {
            revert TitleTooLong();
        }

        if (descriptionLength > MAX_DESCRIPTION_BYTES) {
            revert DescriptionTooLong();
        }

        if (metadataLength == 0) {
            revert InvalidMetadataURI();
        }

        if (metadataLength > MAX_METADATA_URI_BYTES) {
            revert MetadataURITooLong();
        }
    }

    function _validatePricing(
        EventType eventType,
        uint256 depositAmount,
        uint256 totalPrice
    ) private pure {
        if (eventType == EventType.Free) {
            if (totalPrice != 0) {
                revert InvalidFreeEventPricing();
            }
            return;
        }

        bool validPaidPricing =
            depositAmount != 0 &&
            totalPrice != 0 &&
            depositAmount < totalPrice;

        if (!validPaidPricing) {
            revert InvalidPaidEventPricing();
        }
    }

    function _validatePaymentDeadline(
        EventType eventType,
        uint64 paymentDeadline,
        uint64 eventStart
    ) private view {
        if (eventType == EventType.Free) {
            if (paymentDeadline != 0) {
                revert InvalidPaymentDeadline();
            }
            return;
        }

        // paymentDeadline == 0 means this Paid event only supports
        // full payment at reservation time.
        if (paymentDeadline == 0) {
            return;
        }

        bool validPaymentDeadline =
            block.timestamp < paymentDeadline &&
            paymentDeadline < eventStart;

        if (!validPaymentDeadline) {
            revert InvalidPaymentDeadline();
        }
    }

    function _requireReservationAvailable(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private view {
        if (attendee == eventDetails.organizer) {
            revert OrganizerCannotReserve();
        }

        if (block.timestamp >= eventDetails.eventStart) {
            revert ReservationsClosed();
        }

        if (
            eventDetails.capacity != 0 &&
            eventDetails.reservedSeats >= eventDetails.capacity
        ) {
            revert EventAtCapacity();
        }

        Reservation storage reservation = _reservations[eventId][attendee];

        if (
            reservation.status != ReservationStatus.None &&
            reservation.status != ReservationStatus.Cancelled &&
            reservation.status != ReservationStatus.PaymentDefaulted
        ) {
            revert ReservationNotAvailable();
        }
    }

    function _confirmAttendance(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private returns (uint256 organizerPayment) {
        Reservation storage reservation = _reservations[eventId][attendee];

        if (eventDetails.eventType == EventType.Free) {
            if (reservation.status != ReservationStatus.Reserved) {
                revert ReservationNotActive();
            }

            reservation.status = ReservationStatus.Attended;
            reservation.updatedAt = uint64(block.timestamp);

            uint256 attendeeRefund = eventDetails.depositAmount;

            if (attendeeRefund != 0) {
                _consumeEscrow(eventDetails, attendeeRefund);
                usdc.safeTransfer(attendee, attendeeRefund);
            }

            emit AttendanceConfirmed(
                eventId,
                attendee,
                ReservationStatus.Attended,
                attendeeRefund,
                0,
                0
            );

            return 0;
        }

        if (reservation.status != ReservationStatus.Completed) {
            revert ReservationNotActive();
        }

        reservation.status = ReservationStatus.Attended;
        reservation.updatedAt = uint64(block.timestamp);

        organizerPayment = eventDetails.totalPrice;
        _consumeEscrow(eventDetails, organizerPayment);

        emit AttendanceConfirmed(
            eventId,
            attendee,
            ReservationStatus.Attended,
            0,
            organizerPayment,
            0
        );

    }

    function _markNoShow(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private returns (uint256 amount) {
        Reservation storage reservation = _reservations[eventId][attendee];

        if (eventDetails.eventType == EventType.Free) {
            if (reservation.status != ReservationStatus.Reserved) {
                revert ReservationNotActive();
            }
            amount = eventDetails.depositAmount;
        } else {
            if (reservation.status != ReservationStatus.Completed) {
                revert ReservationNotActive();
            }
            amount = eventDetails.totalPrice;
        }

        reservation.status = ReservationStatus.NoShow;
        reservation.updatedAt = uint64(block.timestamp);
        reservation.paymentDeadline = 0;

        if (amount != 0) {
            _consumeEscrow(eventDetails, amount);
        }

        emit NoShowSettled(
            eventId,
            attendee,
            eventDetails.organizer,
            amount
        );
    }

    function _activeReservationEscrow(
        EventDetails storage eventDetails,
        ReservationStatus status
    ) private view returns (uint256) {
        if (eventDetails.eventType == EventType.Free) {
            if (status == ReservationStatus.Reserved) {
                return eventDetails.depositAmount;
            }
            return type(uint256).max;
        }

        if (status == ReservationStatus.PaymentDue) {
            return eventDetails.depositAmount;
        }

        if (status == ReservationStatus.Completed) {
            return eventDetails.totalPrice;
        }

        return type(uint256).max;
    }

    function _listAttendee(uint256 eventId, address attendee) private {
        if (!_attendeeListed[eventId][attendee]) {
            _attendeeListed[eventId][attendee] = true;
            _attendees[eventId].push(attendee);
        }
    }

    function _addEscrow(
        EventDetails storage eventDetails,
        uint256 amount
    ) private {
        if (amount == 0) {
            return;
        }

        eventDetails.escrowedAmount += amount;
        totalEscrowed += amount;
    }

    function _consumeEscrow(
        EventDetails storage eventDetails,
        uint256 amount
    ) private {
        if (amount == 0) {
            return;
        }

        eventDetails.escrowedAmount -= amount;
        totalEscrowed -= amount;
    }

    function _requireAttendanceWindow(
        EventDetails storage eventDetails
    ) private view {
        bool attendanceWindowOpen =
            block.timestamp >= eventDetails.eventStart &&
            block.timestamp <= eventDetails.resolutionDeadline;

        if (!attendanceWindowOpen) {
            revert AttendanceWindowClosed();
        }
    }

    function _requireNoShowWindow(
        EventDetails storage eventDetails
    ) private view {
        bool noShowWindowOpen =
            block.timestamp >= eventDetails.eventEnd &&
            block.timestamp <= eventDetails.resolutionDeadline;

        if (!noShowWindowOpen) {
            revert NoShowWindowClosed();
        }
    }

    function _validateBatchSize(uint256 batchSize) private pure {
        if (batchSize == 0 || batchSize > MAX_BATCH_SIZE) {
            revert InvalidBatchSize();
        }
    }
}
