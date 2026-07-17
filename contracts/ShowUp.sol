// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ShowUp is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PAGE_SIZE = 50;
    uint256 public constant MAX_BATCH_SIZE = 100;

    uint256 public constant MAX_TITLE_BYTES = 320;
    uint256 public constant MAX_DESCRIPTION_BYTES = 960;
    uint256 public constant MAX_METADATA_URI_BYTES = 2048;

    uint256 public constant MAX_RESOLUTION_PERIOD = 7 days;

    IERC20 public immutable usdc;

    uint256 public eventCount;
    uint256 public totalEscrowed;

    enum ReservationStatus {
        None,
        Reserved,
        Cancelled,
        Attended,
        NoShow,
        FallbackRefunded,
        EventCancelledRefunded
    }

    struct EventDetails {
        address organizer;

        string title;
        string description;
        string metadataURI;

        uint256 depositAmount;

        // capacity == 0 means unlimited capacity.
        uint256 capacity;

        uint256 reservedSeats;
        uint256 escrowedAmount;

        uint64 cancellationDeadline;
        uint64 eventStart;
        uint64 eventEnd;
        uint64 resolutionDeadline;

        bool cancelled;
    }

    struct Reservation {
        ReservationStatus status;
        uint64 reservedAt;
        uint64 updatedAt;
    }

    mapping(uint256 => EventDetails) private _events;

    mapping(uint256 => mapping(address => Reservation))
        private _reservations;

    mapping(uint256 => address[]) private _attendees;

    mapping(uint256 => mapping(address => bool))
        private _attendeeListed;

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

    error InvalidDepositAmount();
    error InvalidTimeline();
    error ResolutionPeriodTooLong();

    error EventHasStarted();
    error ReservationsClosed();
    error EventAtCapacity();

    error ReservationNotAvailable();
    error ReservationNotActive();
    error CancellationDeadlinePassed();

    error AttendanceWindowClosed();
    error NoShowWindowClosed();
    error ResolutionDeadlineNotReached();

    error InvalidPageLimit();
    error InvalidBatchSize();

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        string title,
        string metadataURI,
        uint256 depositAmount,
        uint256 capacity
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
        uint256 depositAmount
    );

    event ReservationCancelled(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 refundAmount
    );

    event AttendanceConfirmed(
        uint256 indexed eventId,
        address indexed attendee,
        uint256 refundAmount
    );

    event NoShowSettled(
        uint256 indexed eventId,
        address indexed attendee,
        address indexed organizer,
        uint256 amount
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

    constructor(address usdcAddress) {
        if (usdcAddress == address(0)) {
            revert ZeroAddress();
        }

        usdc = IERC20(usdcAddress);
    }

    function createEvent(
        string calldata title,
        string calldata description,
        string calldata metadataURI,
        uint256 depositAmount,
        uint256 capacity,
        uint64 cancellationDeadline,
        uint64 eventStart,
        uint64 eventEnd,
        uint64 resolutionDeadline
    ) external returns (uint256 eventId) {
        _validateEventContent(
            title,
            description,
            metadataURI
        );

        if (depositAmount == 0) {
            revert InvalidDepositAmount();
        }

        bool validTimeline =
            block.timestamp < cancellationDeadline &&
            cancellationDeadline < eventStart &&
            eventStart < eventEnd &&
            eventEnd < resolutionDeadline;

        if (!validTimeline) {
            revert InvalidTimeline();
        }

        if (
            uint256(resolutionDeadline) -
                uint256(eventEnd) >
            MAX_RESOLUTION_PERIOD
        ) {
            revert ResolutionPeriodTooLong();
        }

        eventId = ++eventCount;

        _events[eventId] = EventDetails({
            organizer: msg.sender,
            title: title,
            description: description,
            metadataURI: metadataURI,
            depositAmount: depositAmount,
            capacity: capacity,
            reservedSeats: 0,
            escrowedAmount: 0,
            cancellationDeadline: cancellationDeadline,
            eventStart: eventStart,
            eventEnd: eventEnd,
            resolutionDeadline: resolutionDeadline,
            cancelled: false
        });

        emit EventCreated(
            eventId,
            msg.sender,
            title,
            metadataURI,
            depositAmount,
            capacity
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
        EventDetails storage eventDetails =
            _events[eventId];

        if (block.timestamp >= eventDetails.eventStart) {
            revert EventHasStarted();
        }

        _validateEventContent(
            title,
            description,
            metadataURI
        );

        eventDetails.title = title;
        eventDetails.description = description;
        eventDetails.metadataURI = metadataURI;

        emit EventContentUpdated(
            eventId,
            msg.sender,
            title,
            metadataURI
        );
    }

    function reserveSeat(
        uint256 eventId
    )
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (block.timestamp >= eventDetails.eventStart) {
            revert ReservationsClosed();
        }

        if (
            eventDetails.capacity != 0 &&
            eventDetails.reservedSeats >=
                eventDetails.capacity
        ) {
            revert EventAtCapacity();
        }

        Reservation storage reservation =
            _reservations[eventId][msg.sender];

        if (
            reservation.status != ReservationStatus.None &&
            reservation.status !=
                ReservationStatus.Cancelled
        ) {
            revert ReservationNotAvailable();
        }

        reservation.status = ReservationStatus.Reserved;
        reservation.reservedAt = uint64(block.timestamp);
        reservation.updatedAt = uint64(block.timestamp);

        eventDetails.reservedSeats += 1;
        eventDetails.escrowedAmount +=
            eventDetails.depositAmount;

        totalEscrowed += eventDetails.depositAmount;

        if (!_attendeeListed[eventId][msg.sender]) {
            _attendeeListed[eventId][msg.sender] = true;
            _attendees[eventId].push(msg.sender);
        }

        usdc.safeTransferFrom(
            msg.sender,
            address(this),
            eventDetails.depositAmount
        );

        emit SeatReserved(
            eventId,
            msg.sender,
            eventDetails.depositAmount
        );
    }

    function cancelReservation(
        uint256 eventId
    )
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (
            block.timestamp >
            eventDetails.cancellationDeadline
        ) {
            revert CancellationDeadlinePassed();
        }

        Reservation storage reservation =
            _reservations[eventId][msg.sender];

        if (
            reservation.status !=
            ReservationStatus.Reserved
        ) {
            revert ReservationNotActive();
        }

        reservation.status =
            ReservationStatus.Cancelled;

        reservation.updatedAt =
            uint64(block.timestamp);

        eventDetails.reservedSeats -= 1;

        _consumeEscrow(eventDetails);

        usdc.safeTransfer(
            msg.sender,
            eventDetails.depositAmount
        );

        emit ReservationCancelled(
            eventId,
            msg.sender,
            eventDetails.depositAmount
        );
    }

    function confirmAttendance(
        uint256 eventId,
        address attendee
    )
        external
        nonReentrant
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        _requireAttendanceWindow(eventDetails);

        _confirmAttendance(
            eventId,
            attendee,
            eventDetails
        );
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

        EventDetails storage eventDetails =
            _events[eventId];

        _requireAttendanceWindow(eventDetails);

        for (
            uint256 index = 0;
            index < attendees.length;
            index++
        ) {
            _confirmAttendance(
                eventId,
                attendees[index],
                eventDetails
            );
        }
    }

    function settleNoShow(
        uint256 eventId,
        address attendee
    )
        external
        nonReentrant
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        _requireNoShowWindow(eventDetails);

        uint256 amount = _markNoShow(
            eventId,
            attendee,
            eventDetails
        );

        usdc.safeTransfer(
            eventDetails.organizer,
            amount
        );
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

        EventDetails storage eventDetails =
            _events[eventId];

        _requireNoShowWindow(eventDetails);

        uint256 totalAmount;

        for (
            uint256 index = 0;
            index < attendees.length;
            index++
        ) {
            totalAmount += _markNoShow(
                eventId,
                attendees[index],
                eventDetails
            );
        }

        usdc.safeTransfer(
            eventDetails.organizer,
            totalAmount
        );
    }

    function claimFallbackRefund(
        uint256 eventId
    )
        external
        nonReentrant
        eventExists(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (
            block.timestamp <=
            eventDetails.resolutionDeadline
        ) {
            revert ResolutionDeadlineNotReached();
        }

        Reservation storage reservation =
            _reservations[eventId][msg.sender];

        if (
            reservation.status !=
            ReservationStatus.Reserved
        ) {
            revert ReservationNotActive();
        }

        reservation.status =
            ReservationStatus.FallbackRefunded;

        reservation.updatedAt =
            uint64(block.timestamp);

        _consumeEscrow(eventDetails);

        usdc.safeTransfer(
            msg.sender,
            eventDetails.depositAmount
        );

        emit FallbackRefundClaimed(
            eventId,
            msg.sender,
            eventDetails.depositAmount
        );
    }

    function cancelEvent(
        uint256 eventId
    )
        external
        eventExists(eventId)
        onlyOrganizer(eventId)
        eventActive(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (block.timestamp >= eventDetails.eventStart) {
            revert EventHasStarted();
        }

        eventDetails.cancelled = true;

        emit EventCancelled(
            eventId,
            msg.sender
        );
    }

    function claimCancelledEventRefund(
        uint256 eventId
    )
        external
        nonReentrant
        eventExists(eventId)
    {
        EventDetails storage eventDetails =
            _events[eventId];

        if (!eventDetails.cancelled) {
            revert EventIsNotCancelled();
        }

        Reservation storage reservation =
            _reservations[eventId][msg.sender];

        if (
            reservation.status !=
            ReservationStatus.Reserved
        ) {
            revert ReservationNotActive();
        }

        reservation.status =
            ReservationStatus.EventCancelledRefunded;

        reservation.updatedAt =
            uint64(block.timestamp);

        _consumeEscrow(eventDetails);

        usdc.safeTransfer(
            msg.sender,
            eventDetails.depositAmount
        );

        emit CancelledEventRefundClaimed(
            eventId,
            msg.sender,
            eventDetails.depositAmount
        );
    }

    function getEvent(
        uint256 eventId
    )
        external
        view
        eventExists(eventId)
        returns (EventDetails memory)
    {
        return _events[eventId];
    }

    function getEventMetadataURI(
        uint256 eventId
    )
        external
        view
        eventExists(eventId)
        returns (string memory)
    {
        return _events[eventId].metadataURI;
    }

    function getReservation(
        uint256 eventId,
        address attendee
    )
        external
        view
        eventExists(eventId)
        returns (Reservation memory)
    {
        return _reservations[eventId][attendee];
    }

    function getAttendeeCount(
        uint256 eventId
    )
        external
        view
        eventExists(eventId)
        returns (uint256)
    {
        return _attendees[eventId].length;
    }

    function getCapacityState(
        uint256 eventId
    )
        external
        view
        eventExists(eventId)
        returns (
            bool unlimited,
            uint256 remaining
        )
    {
        EventDetails storage eventDetails =
            _events[eventId];

        unlimited = eventDetails.capacity == 0;

        if (unlimited) {
            return (true, 0);
        }

        remaining =
            eventDetails.capacity -
            eventDetails.reservedSeats;
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

        uint256 totalAttendees =
            _attendees[eventId].length;

        if (offset >= totalAttendees) {
            return new address[](0);
        }

        uint256 end = offset + limit;

        if (end > totalAttendees) {
            end = totalAttendees;
        }

        attendees =
            new address[](end - offset);

        for (
            uint256 index = offset;
            index < end;
            index++
        ) {
            attendees[index - offset] =
                _attendees[eventId][index];
        }
    }

    function _validateEventContent(
        string calldata title,
        string calldata description,
        string calldata metadataURI
    ) private pure {
        uint256 titleLength = bytes(title).length;
        uint256 descriptionLength =
            bytes(description).length;
        uint256 metadataLength =
            bytes(metadataURI).length;

        if (titleLength == 0) {
            revert InvalidTitle();
        }

        if (titleLength > MAX_TITLE_BYTES) {
            revert TitleTooLong();
        }

        if (
            descriptionLength >
            MAX_DESCRIPTION_BYTES
        ) {
            revert DescriptionTooLong();
        }

        if (metadataLength == 0) {
            revert InvalidMetadataURI();
        }

        if (
            metadataLength >
            MAX_METADATA_URI_BYTES
        ) {
            revert MetadataURITooLong();
        }
    }

    function _confirmAttendance(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private {
        Reservation storage reservation =
            _reservations[eventId][attendee];

        if (
            reservation.status !=
            ReservationStatus.Reserved
        ) {
            revert ReservationNotActive();
        }

        reservation.status =
            ReservationStatus.Attended;

        reservation.updatedAt =
            uint64(block.timestamp);

        _consumeEscrow(eventDetails);

        usdc.safeTransfer(
            attendee,
            eventDetails.depositAmount
        );

        emit AttendanceConfirmed(
            eventId,
            attendee,
            eventDetails.depositAmount
        );
    }

    function _markNoShow(
        uint256 eventId,
        address attendee,
        EventDetails storage eventDetails
    ) private returns (uint256 amount) {
        Reservation storage reservation =
            _reservations[eventId][attendee];

        if (
            reservation.status !=
            ReservationStatus.Reserved
        ) {
            revert ReservationNotActive();
        }

        reservation.status =
            ReservationStatus.NoShow;

        reservation.updatedAt =
            uint64(block.timestamp);

        _consumeEscrow(eventDetails);

        amount = eventDetails.depositAmount;

        emit NoShowSettled(
            eventId,
            attendee,
            eventDetails.organizer,
            amount
        );
    }

    function _consumeEscrow(
        EventDetails storage eventDetails
    ) private {
        eventDetails.escrowedAmount -=
            eventDetails.depositAmount;

        totalEscrowed -= eventDetails.depositAmount;
    }

    function _requireAttendanceWindow(
        EventDetails storage eventDetails
    ) private view {
        bool attendanceWindowOpen =
            block.timestamp >= eventDetails.eventStart &&
            block.timestamp <=
                eventDetails.resolutionDeadline;

        if (!attendanceWindowOpen) {
            revert AttendanceWindowClosed();
        }
    }

    function _requireNoShowWindow(
        EventDetails storage eventDetails
    ) private view {
        bool noShowWindowOpen =
            block.timestamp >= eventDetails.eventEnd &&
            block.timestamp <=
                eventDetails.resolutionDeadline;

        if (!noShowWindowOpen) {
            revert NoShowWindowClosed();
        }
    }

    function _validateBatchSize(
        uint256 batchSize
    ) private pure {
        if (
            batchSize == 0 ||
            batchSize > MAX_BATCH_SIZE
        ) {
            revert InvalidBatchSize();
        }
    }
}
