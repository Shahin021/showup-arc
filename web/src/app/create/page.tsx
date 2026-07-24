"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import CircleWalletButton from "@/components/circle-wallet-button";

const CIRCLE_USER_ID_KEY = "showup_circle_user_id";
const CIRCLE_WALLET_READY_KEY = "showup_circle_wallet_ready";
const CIRCLE_WALLET_ADDRESS_KEY =
  "showup_circle_wallet_address";
const CIRCLE_WALLET_ID_KEY = "showup_circle_wallet_id";
const EVENT_SUBMISSIONS_KEY = "showup_event_submissions";

const MAX_EVENT_IMAGE_BYTES = 3_000_000;
const MAX_AVATAR_BYTES = 750_000;
const MAX_VIDEO_BYTES = 50_000_000;

const inputClassName =
  "mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#74f2c2]/60 focus:bg-[#74f2c2]/[0.04] disabled:cursor-not-allowed disabled:opacity-40";

const labelClassName =
  "block text-sm font-medium text-white/75";

type SubmissionState =
  | "idle"
  | "preparing"
  | "awaiting"
  | "submitted"
  | "error";

type VideoMode =
  | "none"
  | "upload"
  | "external";

type EventType =
  | "free"
  | "paid";

type SessionResponse = {
  userId?: string;
  userToken?: string;
  encryptionKey?: string;
  error?: string;
};

type ChallengeResponse = {
  challengeId?: string;
  refId?: string;
  createdAfter?: string;
  error?: string;
};

type MetadataResponse = {
  metadataURI?: string;
  error?: string;
};

type StoredSubmission = {
  refId: string;
  title: string;
  description: string;
  metadataURI: string;
  eventType: EventType;
  deposit: string;
  totalPrice: string;
  capacity: string;
  unlimited: boolean;
  eventStart: string;
  eventEnd: string;
  walletAddress: string;
  status: "submitted";
  createdAt: string;
};

function formatDate(value: string) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return "Something went wrong while creating the event.";
}

function validateImage(
  file: File | null,
  maximumBytes: number,
  fieldName: string,
) {
  if (!file) {
    return;
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error(
      `${fieldName} must be a JPEG, PNG, or WebP image.`,
    );
  }

  if (file.size > maximumBytes) {
    throw new Error(
      `${fieldName} is larger than the allowed size.`,
    );
  }
}

function validateOptionalHttpsUrl(
  value: string,
  fieldName: string,
) {
  const normalized = value.trim();

  if (!normalized) {
    return "";
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `${fieldName} is not a valid URL.`,
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `${fieldName} must use HTTPS.`,
    );
  }

  return parsed.toString();
}

async function requestCircleSession(
  userId: string,
): Promise<{
  userToken: string;
  encryptionKey: string;
}> {
  const response = await fetch(
    "/api/circle/session",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userId,
      }),
    },
  );

  const data =
    (await response.json()) as SessionResponse;

  if (
    !response.ok ||
    !data.userToken ||
    !data.encryptionKey
  ) {
    throw new Error(
      data.error ??
        "Unable to create a secure Circle session.",
    );
  }

  return {
    userToken: data.userToken,
    encryptionKey: data.encryptionKey,
  };
}

async function executeCircleChallenge(
  challengeId: string,
  userToken: string,
  encryptionKey: string,
) {
  const appId =
    process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

  if (!appId) {
    throw new Error(
      "Circle App ID is not configured.",
    );
  }

  const { W3SSdk } = await import(
    "@circle-fin/w3s-pw-web-sdk"
  );

  const circleSdk = new W3SSdk({
    appSettings: {
      appId,
    },
  });

  await circleSdk.getDeviceId();

  circleSdk.setAuthentication({
    userToken,
    encryptionKey,
  });

  await new Promise<void>(
    (resolve, reject) => {
      const timeout = window.setTimeout(
        () => {
          reject(
            new Error(
              "Circle approval timed out. No transaction was submitted.",
            ),
          );
        },
        10 * 60 * 1000,
      );

      circleSdk.execute(
        challengeId,
        (error, result) => {
          window.clearTimeout(timeout);

          if (error) {
            reject(
              new Error(
                error.message ||
                  `Circle authorization failed${
                    error.code
                      ? ` (${error.code})`
                      : ""
                  }.`,
              ),
            );
            return;
          }

          if (
            !result ||
            result.status !== "COMPLETE"
          ) {
            reject(
              new Error(
                "Circle authorization was not completed.",
              ),
            );
            return;
          }

          resolve();
        },
      );
    },
  );
}

function saveSubmission(
  submission: StoredSubmission,
) {
  let submissions: StoredSubmission[] = [];

  try {
    const stored =
      window.localStorage.getItem(
        EVENT_SUBMISSIONS_KEY,
      );

    if (stored) {
      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        submissions = parsed;
      }
    }
  } catch {
    submissions = [];
  }

  const updated = [
    submission,
    ...submissions.filter(
      (item) =>
        item.refId !== submission.refId,
    ),
  ].slice(0, 50);

  window.localStorage.setItem(
    EVENT_SUBMISSIONS_KEY,
    JSON.stringify(updated),
  );
}

export default function CreateEventPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] =
    useState("");
  const [
    fullDescription,
    setFullDescription,
  ] = useState("");
  const [location, setLocation] =
    useState("");

  const [organizerName, setOrganizerName] =
    useState("");
  const [organizerBio, setOrganizerBio] =
    useState("");
  const [
    organizerWebsite,
    setOrganizerWebsite,
  ] = useState("");
  const [organizerX, setOrganizerX] =
    useState("");

  const [rules, setRules] = useState("");

  const [eventImage, setEventImage] =
    useState<File | null>(null);
  const [
    organizerAvatar,
    setOrganizerAvatar,
  ] = useState<File | null>(null);

  const [eventImagePreview, setEventImagePreview] =
    useState("");
  const [avatarPreview, setAvatarPreview] =
    useState("");

  const [videoMode, setVideoMode] =
    useState<VideoMode>("none");
  const [videoFile, setVideoFile] =
    useState<File | null>(null);
  const [
    externalVideoUrl,
    setExternalVideoUrl,
  ] = useState("");
  const [
    videoUploadProgress,
    setVideoUploadProgress,
  ] = useState(0);

  const [eventType, setEventType] =
    useState<EventType>("free");
  const [deposit, setDeposit] =
    useState("2");
  const [totalPrice, setTotalPrice] =
    useState("10");
  const [capacity, setCapacity] =
    useState("30");
  const [
    unlimitedCapacity,
    setUnlimitedCapacity,
  ] = useState(false);

  const [eventStart, setEventStart] =
    useState("");
  const [eventEnd, setEventEnd] =
    useState("");
  const [
    cancellationHours,
    setCancellationHours,
  ] = useState("24");
  const [
    resolutionHours,
    setResolutionHours,
  ] = useState("12");

  const [message, setMessage] =
    useState("");
  const [
    submissionState,
    setSubmissionState,
  ] =
    useState<SubmissionState>("idle");

  useEffect(() => {
    if (!eventImage) {
      setEventImagePreview("");
      return;
    }

    const preview =
      URL.createObjectURL(eventImage);

    setEventImagePreview(preview);

    return () => {
      URL.revokeObjectURL(preview);
    };
  }, [eventImage]);

  useEffect(() => {
    if (!organizerAvatar) {
      setAvatarPreview("");
      return;
    }

    const preview =
      URL.createObjectURL(
        organizerAvatar,
      );

    setAvatarPreview(preview);

    return () => {
      URL.revokeObjectURL(preview);
    };
  }, [organizerAvatar]);

  const availableSeats = useMemo(() => {
    if (unlimitedCapacity) {
      return "Unlimited";
    }

    const parsedCapacity =
      Number(capacity);

    if (
      !Number.isSafeInteger(
        parsedCapacity,
      ) ||
      parsedCapacity < 1
    ) {
      return "0";
    }

    return String(parsedCapacity);
  }, [
    capacity,
    unlimitedCapacity,
  ]);

  const buttonLabel =
    submissionState === "preparing"
      ? videoUploadProgress > 0 &&
        videoUploadProgress < 100
        ? `Uploading video... ${videoUploadProgress}%`
        : "Preparing event..."
      : submissionState === "awaiting"
        ? "Waiting for Circle approval..."
        : submissionState === "submitted"
          ? "Event transaction submitted"
          : "Create event on Arc";

  async function handleSubmit(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (
      submissionState === "preparing" ||
      submissionState === "awaiting"
    ) {
      return;
    }

    setMessage("");
    setVideoUploadProgress(0);
    setSubmissionState("preparing");

    try {
      const normalizedTitle =
        title.trim();
      const normalizedDescription =
        description.trim();
      const normalizedFullDescription =
        fullDescription.trim();
      const normalizedOrganizerName =
        organizerName.trim();

      if (
        !normalizedTitle ||
        !normalizedFullDescription ||
        !normalizedOrganizerName ||
        !deposit ||
        (eventType === "paid" &&
          !totalPrice) ||
        !eventStart ||
        !eventEnd
      ) {
        throw new Error(
          "Complete all required fields before continuing.",
        );
      }

      if (
        !/^\d+(?:\.\d{1,6})?$/.test(
          deposit,
        )
      ) {
        throw new Error(
          "Deposit must be a valid USDC amount with up to 6 decimal places.",
        );
      }

      if (Number(deposit) < 0) {
        throw new Error(
          "Commitment deposit cannot be negative.",
        );
      }

      if (eventType === "paid") {
        if (
          !/^\d+(?:\.\d{1,6})?$/.test(
            totalPrice,
          )
        ) {
          throw new Error(
            "Total price must be a valid USDC amount with up to 6 decimal places.",
          );
        }

        if (Number(deposit) <= 0) {
          throw new Error(
            "Upfront payment must be greater than zero.",
          );
        }

        if (Number(totalPrice) <= 0) {
          throw new Error(
            "Total price must be greater than zero.",
          );
        }

        if (
          Number(deposit) >=
          Number(totalPrice)
        ) {
          throw new Error(
            "Upfront payment must be lower than the total price.",
          );
        }
      }

      const normalizedCapacity =
        unlimitedCapacity
          ? "0"
          : capacity.trim();

      if (
        !unlimitedCapacity &&
        (
          !/^\d+$/.test(
            normalizedCapacity,
          ) ||
          Number(normalizedCapacity) < 1
        )
      ) {
        throw new Error(
          "Capacity must be a positive whole number.",
        );
      }

      const startDate =
        new Date(eventStart);
      const endDate =
        new Date(eventEnd);

      if (
        Number.isNaN(
          startDate.getTime(),
        ) ||
        Number.isNaN(
          endDate.getTime(),
        )
      ) {
        throw new Error(
          "Enter valid event start and end times.",
        );
      }

      if (endDate <= startDate) {
        throw new Error(
          "Event end must be later than event start.",
        );
      }

      const parsedCancellationHours =
        Number(cancellationHours);
      const parsedResolutionHours =
        Number(resolutionHours);

      if (
        !Number.isSafeInteger(
          parsedCancellationHours,
        ) ||
        parsedCancellationHours < 1
      ) {
        throw new Error(
          "Cancellation period must be a positive whole number.",
        );
      }

      if (
        !Number.isSafeInteger(
          parsedResolutionHours,
        ) ||
        parsedResolutionHours < 1 ||
        parsedResolutionHours > 168
      ) {
        throw new Error(
          "Resolution period must be between 1 and 168 hours.",
        );
      }

      const millisecondsUntilStart =
        startDate.getTime() -
        Date.now();

      const depositReservationsAvailable =
        millisecondsUntilStart >
        24 *
          60 *
          60 *
          1000;

      if (
        eventType === "paid" &&
        depositReservationsAvailable &&
        parsedCancellationHours < 24
      ) {
        throw new Error(
          "Paid events with upfront reservations require a cancellation period of at least 24 hours.",
        );
      }

      const cancellationDeadline =
        startDate.getTime() -
        parsedCancellationHours *
          60 *
          60 *
          1000;

      if (
        cancellationDeadline <=
        Date.now()
      ) {
        throw new Error(
          "The cancellation deadline must still be in the future. Move the event later or shorten the cancellation period.",
        );
      }

      validateImage(
        eventImage,
        MAX_EVENT_IMAGE_BYTES,
        "Event image",
      );

      validateImage(
        organizerAvatar,
        MAX_AVATAR_BYTES,
        "Organizer avatar",
      );

      if (
        videoMode === "upload" &&
        !videoFile
      ) {
        throw new Error(
          "Choose an MP4 or WebM video to upload.",
        );
      }

      if (
        videoMode === "external" &&
        !externalVideoUrl.trim()
      ) {
        throw new Error(
          "Enter a YouTube, Vimeo, X, or video URL.",
        );
      }

      if (videoFile) {
        if (
          ![
            "video/mp4",
            "video/webm",
          ].includes(videoFile.type)
        ) {
          throw new Error(
            "Promo video must be MP4 or WebM.",
          );
        }

        if (
          videoFile.size >
          MAX_VIDEO_BYTES
        ) {
          throw new Error(
            "Promo video must be 50 MB or smaller.",
          );
        }
      }

      const normalizedWebsite =
        validateOptionalHttpsUrl(
          organizerWebsite,
          "Organizer website",
        );

      let normalizedVideoUrl = "";

      if (
        videoMode === "external"
      ) {
        normalizedVideoUrl =
          validateOptionalHttpsUrl(
            externalVideoUrl,
            "Video URL",
          );
      }

      const circleUserId =
        window.localStorage.getItem(
          CIRCLE_USER_ID_KEY,
        ) ?? "";

      const walletReady =
        window.localStorage.getItem(
          CIRCLE_WALLET_READY_KEY,
        ) === "true";

      const walletId =
        window.localStorage.getItem(
          CIRCLE_WALLET_ID_KEY,
        ) ?? "";

      const walletAddress =
        window.localStorage.getItem(
          CIRCLE_WALLET_ADDRESS_KEY,
        ) ?? "";

      if (
        !circleUserId ||
        !walletReady ||
        !walletId ||
        !walletAddress
      ) {
        throw new Error(
          "Connect your Circle wallet before creating an event.",
        );
      }

      setMessage(
        "Creating a secure Circle session...",
      );

      const session =
        await requestCircleSession(
          circleUserId,
        );

      if (
        videoMode === "upload" &&
        videoFile
      ) {
        setMessage(
          "Uploading the promotional video to secure storage...",
        );

        const extension =
          videoFile.type ===
          "video/webm"
            ? "webm"
            : "mp4";

        const videoPath =
          `showup/videos/${walletId}/` +
          `${crypto.randomUUID()}.${extension}`;

        const videoBlob =
          await upload(
            videoPath,
            videoFile,
            {
              access: "public",
              handleUploadUrl:
                "/api/uploads/event-video",
              clientPayload:
                JSON.stringify({
                  userToken:
                    session.userToken,
                  walletId,
                }),
              multipart: true,
              onUploadProgress: ({
                percentage,
              }) => {
                setVideoUploadProgress(
                  Math.round(
                    percentage,
                  ),
                );
              },
            },
          );

        normalizedVideoUrl =
          videoBlob.url;
      }

      setMessage(
        "Uploading event details and images...",
      );

      const metadataFormData =
        new FormData();

      metadataFormData.set(
        "userToken",
        session.userToken,
      );
      metadataFormData.set(
        "walletId",
        walletId,
      );
      metadataFormData.set(
        "organizerName",
        normalizedOrganizerName,
      );
      metadataFormData.set(
        "fullDescription",
        normalizedFullDescription,
      );
      metadataFormData.set(
        "location",
        location.trim(),
      );
      metadataFormData.set(
        "organizerBio",
        organizerBio.trim(),
      );
      metadataFormData.set(
        "organizerWebsite",
        normalizedWebsite,
      );
      metadataFormData.set(
        "organizerX",
        organizerX.trim(),
      );
      metadataFormData.set(
        "rules",
        rules.trim(),
      );

      if (
        eventImage
      ) {
        metadataFormData.set(
          "eventImage",
          eventImage,
        );
      }

      if (
        organizerAvatar
      ) {
        metadataFormData.set(
          "organizerAvatar",
          organizerAvatar,
        );
      }

      if (
        videoMode !== "none" &&
        normalizedVideoUrl
      ) {
        metadataFormData.set(
          "videoSource",
          videoMode === "upload"
            ? "upload"
            : "external",
        );
        metadataFormData.set(
          "videoUrl",
          normalizedVideoUrl,
        );
      }

      const metadataResponse =
        await fetch(
          "/api/uploads/event-metadata",
          {
            method: "POST",
            cache: "no-store",
            body: metadataFormData,
          },
        );

      const metadataData =
        (await metadataResponse.json()) as MetadataResponse;

      if (
        !metadataResponse.ok ||
        !metadataData.metadataURI
      ) {
        throw new Error(
          metadataData.error ??
            "Unable to upload event metadata.",
        );
      }

      setMessage(
        "Creating a secure Circle transaction challenge...",
      );

      const challengeResponse =
        await fetch(
          "/api/circle/events/create",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              userToken:
                session.userToken,
              walletId,
              title:
                normalizedTitle,
              description:
                normalizedDescription,
              metadataURI:
                metadataData.metadataURI,
              eventType,
              deposit,
              totalPrice:
                eventType === "paid"
                  ? totalPrice
                  : "0",
              capacity:
                normalizedCapacity,
              eventStart:
                startDate.toISOString(),
              eventEnd:
                endDate.toISOString(),
              cancellationHours,
              resolutionHours,
            }),
          },
        );

      const challengeData =
        (await challengeResponse.json()) as ChallengeResponse;

      if (
        !challengeResponse.ok ||
        !challengeData.challengeId
      ) {
        throw new Error(
          challengeData.error ??
            "Unable to prepare the event transaction.",
        );
      }

      setSubmissionState(
        "awaiting",
      );
      setMessage(
        "Confirm the transaction with your Circle PIN.",
      );

      await executeCircleChallenge(
        challengeData.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      const refId =
        challengeData.refId ??
        `showup-event-${Date.now()}`;

      saveSubmission({
        refId,
        title:
          normalizedTitle,
        description:
          normalizedDescription,
        metadataURI:
          metadataData.metadataURI,
        eventType,
        deposit,
        totalPrice:
          eventType === "paid"
            ? totalPrice
            : "0",
        capacity:
          normalizedCapacity,
        unlimited:
          unlimitedCapacity,
        eventStart,
        eventEnd,
        walletAddress,
        status: "submitted",
        createdAt:
          new Date().toISOString(),
      });

      setVideoUploadProgress(100);
      setSubmissionState(
        "submitted",
      );
      setMessage(
        `Circle authorization completed. Your event transaction was submitted to Arc Testnet. Reference: ${refId}`,
      );
    } catch (error) {
      console.error(
        "ShowUp event submission failed:",
        error,
      );

      setSubmissionState("error");
      setMessage(
        getErrorMessage(error),
      );
    }
  }

  const formDisabled =
    submissionState === "preparing" ||
    submissionState === "awaiting";

  return (
    <main className="min-h-screen bg-[#07110f] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#74f2c2] font-black text-[#07110f]">
              S
            </div>

            <div>
              <p className="font-semibold">
                ShowUp
              </p>
              <p className="text-xs text-white/35">
                Built on Arc
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden text-sm text-white/45 transition hover:text-white sm:block"
            >
              Back home
            </Link>

            <CircleWalletButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
        <div className="mb-8 max-w-3xl">
          <div className="inline-flex rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-xs font-medium text-[#aaffdf]">
            Live on Arc Testnet
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Create an accountable event.
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-7 text-white/45">
            Create free commitment-based events or paid events with transparent USDC pricing directly on Arc.
          </p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <form
            onSubmit={handleSubmit}
            className="rounded-[30px] border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/20 sm:p-8"
          >
            <section>
              <div className="flex items-start justify-between gap-5">
                <div>
                  <h2 className="text-xl font-semibold">
                    Event details
                  </h2>

                  <p className="mt-2 text-sm text-white/40">
                    The short fields are written onchain. Rich details are stored in public event metadata.
                  </p>
                </div>

                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">
                  Arc Testnet
                </span>
              </div>

              <div className="mt-6">
                <label className={labelClassName}>
                  Event title
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <input
                    type="text"
                    value={title}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setTitle(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                    placeholder="Arc Builders Workshop"
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="mt-5">
                <label className={labelClassName}>
                  Short onchain description

                  <textarea
                    value={description}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setDescription(
                        event.target.value,
                      )
                    }
                    className={`${inputClassName} min-h-24 resize-none`}
                    placeholder="A short summary shown in event cards."
                    maxLength={240}
                  />
                </label>

                <p className="mt-2 text-right text-xs text-white/30">
                  {description.length} / 240
                </p>
              </div>

              <div className="mt-5">
                <label className={labelClassName}>
                  Full event description
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <textarea
                    value={fullDescription}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setFullDescription(
                        event.target.value,
                      )
                    }
                    className={`${inputClassName} min-h-40 resize-y`}
                    placeholder="Explain the agenda, audience, benefits, and what attendees should expect."
                    maxLength={5000}
                  />
                </label>

                <p className="mt-2 text-right text-xs text-white/30">
                  {fullDescription.length} / 5000
                </p>
              </div>

              <div className="mt-5">
                <label className={labelClassName}>
                  Location

                  <input
                    type="text"
                    value={location}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setLocation(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                    placeholder="Online, Rome, or venue address"
                    maxLength={240}
                  />
                </label>
              </div>

              <div className="mt-5">
                <label className={labelClassName}>
                  Event cover image

                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={formDisabled}
                    onChange={(event) =>
                      setEventImage(
                        event.target.files?.[0] ??
                          null,
                      )
                    }
                    className={`${inputClassName} file:mr-4 file:rounded-xl file:border-0 file:bg-[#74f2c2] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#07110f]`}
                  />
                </label>

                <p className="mt-2 text-xs text-white/30">
                  Optional — JPEG, PNG or WebP, maximum 3 MB.
                </p>
              </div>
            </section>

            <section className="mt-9 border-t border-white/10 pt-8">
              <h2 className="text-xl font-semibold">
                Organizer profile
              </h2>

              <p className="mt-2 text-sm text-white/40">
                Help attendees understand who is responsible for the event.
              </p>

              <div className="mt-6">
                <label className={labelClassName}>
                  Organizer name
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <input
                    type="text"
                    value={organizerName}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setOrganizerName(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                    placeholder="Organizer or community name"
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="mt-5">
                <label className={labelClassName}>
                  Organizer avatar

                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={formDisabled}
                    onChange={(event) =>
                      setOrganizerAvatar(
                        event.target.files?.[0] ??
                          null,
                      )
                    }
                    className={`${inputClassName} file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white`}
                  />
                </label>

                <p className="mt-2 text-xs text-white/30">
                  Optional — maximum 750 KB.
                </p>
              </div>

              <div className="mt-5">
                <label className={labelClassName}>
                  Organizer bio

                  <textarea
                    value={organizerBio}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setOrganizerBio(
                        event.target.value,
                      )
                    }
                    className={`${inputClassName} min-h-28 resize-y`}
                    placeholder="Briefly describe your experience or community."
                    maxLength={1200}
                  />
                </label>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <label className={labelClassName}>
                  Website

                  <input
                    type="url"
                    value={organizerWebsite}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setOrganizerWebsite(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                    placeholder="https://example.com"
                    maxLength={300}
                  />
                </label>

                <label className={labelClassName}>
                  X profile

                  <input
                    type="text"
                    value={organizerX}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setOrganizerX(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                    placeholder="@username or profile URL"
                    maxLength={100}
                  />
                </label>
              </div>
            </section>

            <section className="mt-9 border-t border-white/10 pt-8">
              <h2 className="text-xl font-semibold">
                Promotional video
              </h2>

              <p className="mt-2 text-sm text-white/40">
                Optional. Upload a file or provide an external video link.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["none", "No video"],
                    ["upload", "Upload video"],
                    ["external", "Video link"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    disabled={formDisabled}
                    onClick={() => {
                      setVideoMode(value);
                      setVideoUploadProgress(0);
                    }}
                    className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                      videoMode === value
                        ? "border-[#74f2c2]/50 bg-[#74f2c2]/10 text-[#b7ffe3]"
                        : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/70"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {videoMode === "upload" ? (
                <div className="mt-5">
                  <label className={labelClassName}>
                    Promo video file

                    <input
                      type="file"
                      accept="video/mp4,video/webm"
                      disabled={formDisabled}
                      onChange={(event) => {
                        setVideoFile(
                          event.target.files?.[0] ??
                            null,
                        );
                        setVideoUploadProgress(0);
                      }}
                      className={`${inputClassName} file:mr-4 file:rounded-xl file:border-0 file:bg-[#74f2c2] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#07110f]`}
                    />
                  </label>

                  <p className="mt-2 text-xs text-white/30">
                    MP4 or WebM — maximum 50 MB.
                  </p>

                  {videoFile ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-white/65">
                          {videoFile.name}
                        </span>

                        <span className="shrink-0 text-white/35">
                          {(videoFile.size / 1_000_000).toFixed(1)} MB
                        </span>
                      </div>

                      {videoUploadProgress > 0 ? (
                        <div className="mt-3">
                          <div className="h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-[#74f2c2] transition-all"
                              style={{
                                width: `${videoUploadProgress}%`,
                              }}
                            />
                          </div>

                          <p className="mt-2 text-right text-xs text-white/35">
                            {videoUploadProgress}%
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {videoMode === "external" ? (
                <div className="mt-5">
                  <label className={labelClassName}>
                    External video URL

                    <input
                      type="url"
                      value={externalVideoUrl}
                      disabled={formDisabled}
                      onChange={(event) =>
                        setExternalVideoUrl(
                          event.target.value,
                        )
                      }
                      className={inputClassName}
                      placeholder="https://youtube.com/watch?v=..."
                      maxLength={2000}
                    />
                  </label>

                  <p className="mt-2 text-xs text-white/30">
                    YouTube, Vimeo, X, or another HTTPS video URL.
                  </p>
                </div>
              ) : null}
            </section>

            <section className="mt-9 border-t border-white/10 pt-8">
              <h2 className="text-xl font-semibold">
                Attendance rules
              </h2>

              <div className="mt-5">
                <label className={labelClassName}>
                  Rules and attendee instructions

                  <textarea
                    value={rules}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setRules(
                        event.target.value,
                      )
                    }
                    className={`${inputClassName} min-h-32 resize-y`}
                    placeholder="Explain check-in rules, requirements, and anything attendees should bring."
                    maxLength={3000}
                  />
                </label>
              </div>
            </section>

            <section className="mt-9 border-t border-white/10 pt-8">
              <h2 className="text-xl font-semibold">
                Pricing and capacity
              </h2>

              <div className="mt-6">
                <p className="text-sm font-medium text-white/75">
                  Event type
                </p>

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={formDisabled}
                    onClick={() =>
                      setEventType("free")
                    }
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      eventType === "free"
                        ? "border-[#74f2c2]/60 bg-[#74f2c2]/10 text-white"
                        : "border-white/10 bg-white/[0.035] text-white/45 hover:border-white/20"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="block text-sm font-semibold">
                      Free event
                    </span>

                    <span className="mt-1 block text-xs leading-5 opacity-70">
                      Optional refundable commitment deposit
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={formDisabled}
                    onClick={() =>
                      setEventType("paid")
                    }
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      eventType === "paid"
                        ? "border-[#74f2c2]/60 bg-[#74f2c2]/10 text-white"
                        : "border-white/10 bg-white/[0.035] text-white/45 hover:border-white/20"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <span className="block text-sm font-semibold">
                      Paid event
                    </span>

                    <span className="mt-1 block text-xs leading-5 opacity-70">
                      Upfront payment plus remaining balance
                    </span>
                  </button>
                </div>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className={labelClassName}>
                  {eventType === "paid"
                    ? "Upfront payment"
                    : "Commitment deposit"}
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <div className="relative">
                    <input
                      type="number"
                      min={
                        eventType === "paid"
                          ? "0.000001"
                          : "0"
                      }
                      step="0.000001"
                      value={deposit}
                      disabled={formDisabled}
                      onChange={(event) =>
                        setDeposit(
                          event.target.value,
                        )
                      }
                      className={`${inputClassName} pr-20`}
                    />

                    <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm font-medium text-[#74f2c2]">
                      USDC
                    </span>
                  </div>
                </label>

                {eventType === "paid" ? (
                  <label className={labelClassName}>
                    Total price
                    <span className="ml-1 text-[#74f2c2]">
                      *
                    </span>

                    <div className="relative">
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        value={totalPrice}
                        disabled={formDisabled}
                        onChange={(event) =>
                          setTotalPrice(
                            event.target.value,
                          )
                        }
                        className={`${inputClassName} pr-20`}
                      />

                      <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm font-medium text-[#74f2c2]">
                        USDC
                      </span>
                    </div>

                    <p className="mt-2 text-xs leading-5 text-white/30">
                      Must be greater than the upfront payment.
                    </p>
                  </label>
                ) : null}

                <div
                  className={
                    eventType === "paid"
                      ? "sm:col-span-2"
                      : ""
                  }
                >
                  <label className={labelClassName}>
                    Event capacity
                    <span className="ml-1 text-[#74f2c2]">
                      *
                    </span>

                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={capacity}
                      disabled={
                        unlimitedCapacity ||
                        formDisabled
                      }
                      onChange={(event) =>
                        setCapacity(
                          event.target.value,
                        )
                      }
                      className={inputClassName}
                    />
                  </label>

                  <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-white/55">
                    <input
                      type="checkbox"
                      checked={
                        unlimitedCapacity
                      }
                      disabled={formDisabled}
                      onChange={(event) =>
                        setUnlimitedCapacity(
                          event.target.checked,
                        )
                      }
                      className="h-4 w-4 accent-[#74f2c2]"
                    />

                    Unlimited capacity
                  </label>
                </div>
              </div>
            </section>

            <section className="mt-9 border-t border-white/10 pt-8">
              <h2 className="text-xl font-semibold">
                Event timeline
              </h2>

              <p className="mt-2 text-sm text-white/40">
                All deadlines are converted into onchain Unix timestamps.
              </p>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className={labelClassName}>
                  Event start
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <input
                    type="datetime-local"
                    value={eventStart}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setEventStart(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                  />
                </label>

                <label className={labelClassName}>
                  Event end
                  <span className="ml-1 text-[#74f2c2]">
                    *
                  </span>

                  <input
                    type="datetime-local"
                    value={eventEnd}
                    disabled={formDisabled}
                    onChange={(event) =>
                      setEventEnd(
                        event.target.value,
                      )
                    }
                    className={inputClassName}
                  />
                </label>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <label className={labelClassName}>
                  Free cancellation period

                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={cancellationHours}
                      disabled={formDisabled}
                      onChange={(event) =>
                        setCancellationHours(
                          event.target.value,
                        )
                      }
                      className={`${inputClassName} pr-20`}
                    />

                    <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm text-white/35">
                      hours
                    </span>
                  </div>

                  <span className="mt-2 block text-xs font-normal leading-5 text-white/30">
                    Cancellation closes this many hours before the event.
                  </span>
                </label>

                <label className={labelClassName}>
                  Organizer resolution period

                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="168"
                      step="1"
                      value={resolutionHours}
                      disabled={formDisabled}
                      onChange={(event) =>
                        setResolutionHours(
                          event.target.value,
                        )
                      }
                      className={`${inputClassName} pr-20`}
                    />

                    <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm text-white/35">
                      hours
                    </span>
                  </div>

                  <span className="mt-2 block text-xs font-normal leading-5 text-white/30">
                    Unresolved reservations can claim a fallback refund after this period.
                  </span>
                </label>
              </div>
            </section>

            <div className="mt-8 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
              <p className="text-sm leading-6 text-[#c7ffea]">
                Creating an event does not lock a deposit. Deposits enter escrow only when attendees reserve seats.
              </p>
            </div>

            {message ? (
              <div
                className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-6 ${
                  submissionState === "error"
                    ? "border-red-400/20 bg-red-400/10 text-red-200"
                    : submissionState === "submitted"
                      ? "border-[#74f2c2]/30 bg-[#74f2c2]/10 text-[#c7ffea]"
                      : "border-white/10 bg-white/[0.04] text-white/65"
                }`}
              >
                {message}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={formDisabled}
              className="mt-6 w-full rounded-2xl bg-[#74f2c2] py-4 font-semibold text-[#07110f] transition hover:bg-[#9dffda] disabled:cursor-wait disabled:opacity-60"
            >
              {buttonLabel}
            </button>

            <p className="mt-4 text-center text-xs text-white/30">
              No transaction is sent until you approve it inside Circle&apos;s secure PIN window.
            </p>
          </form>

          <aside className="lg:sticky lg:top-8">
            <div className="overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/30">
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0b1916]">
                {eventImagePreview ? (
                  <div
                    className="h-48 bg-cover bg-center"
                    style={{
                      backgroundImage: `url("${eventImagePreview}")`,
                    }}
                  />
                ) : (
                  <div className="grid h-40 place-items-center bg-gradient-to-br from-[#74f2c2]/15 to-transparent text-sm text-white/30">
                    Event cover preview
                  </div>
                )}

                <div className="p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#74f2c2]">
                        Live preview
                      </p>

                      <h2 className="mt-3 break-words text-2xl font-semibold">
                        {title.trim() ||
                          "Untitled event"}
                      </h2>

                      <p className="mt-2 break-words text-sm leading-6 text-white/45">
                        {description.trim() ||
                          "Your event description will appear here."}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-2xl bg-[#74f2c2] px-3 py-2 text-center text-[#07110f]">
                      <p className="text-xs font-semibold uppercase">
                        {eventStart
                          ? new Date(
                              eventStart,
                            ).toLocaleString(
                              undefined,
                              {
                                month: "short",
                              },
                            )
                          : "DATE"}
                      </p>

                      <p className="text-xl font-black">
                        {eventStart
                          ? new Date(
                              eventStart,
                            ).getDate()
                          : "--"}
                      </p>
                    </div>
                  </div>

                  {(organizerName ||
                    avatarPreview) ? (
                    <div className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                      {avatarPreview ? (
                        <div
                          className="h-11 w-11 shrink-0 rounded-full bg-cover bg-center"
                          style={{
                            backgroundImage: `url("${avatarPreview}")`,
                          }}
                        />
                      ) : (
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold text-white/40">
                          {organizerName
                            .trim()
                            .slice(0, 1)
                            .toUpperCase() ||
                            "O"}
                        </div>
                      )}

                      <div className="min-w-0">
                        <p className="text-xs text-white/30">
                          Organized by
                        </p>

                        <p className="truncate text-sm font-medium text-white/70">
                          {organizerName.trim() ||
                            "Organizer"}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {location.trim() ? (
                    <p className="mt-4 text-sm text-white/45">
                      📍 {location.trim()}
                    </p>
                  ) : null}

                  <div className="my-6 h-px bg-white/10" />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        {eventType === "paid"
                          ? "Upfront payment"
                          : "Commitment deposit"}
                      </p>

                      <p className="mt-2 text-xl font-semibold">
                        {deposit || "0"} USDC
                      </p>
                    </div>

                    {eventType === "paid" ? (
                      <div className="rounded-2xl bg-white/[0.04] p-4">
                        <p className="text-xs leading-5 text-white/35">
                          Total price
                        </p>

                        <p className="mt-2 text-xl font-semibold">
                          {totalPrice || "0"} USDC
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl bg-white/[0.04] p-4">
                        <p className="text-xs leading-5 text-white/35">
                          Available seats
                        </p>

                        <p className="mt-2 break-words text-xl font-semibold">
                          {availableSeats}
                        </p>
                      </div>
                    )}

                    {eventType === "paid" ? (
                      <div className="col-span-2 rounded-2xl bg-white/[0.04] p-4">
                        <p className="text-xs leading-5 text-white/35">
                          Available seats
                        </p>

                        <p className="mt-2 break-words text-xl font-semibold">
                          {availableSeats}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                    <div>
                      <p className="text-xs text-white/30">
                        Starts
                      </p>

                      <p className="mt-1 text-sm font-medium text-white/70">
                        {formatDate(eventStart)}
                      </p>
                    </div>

                    <div className="h-px bg-white/10" />

                    <div>
                      <p className="text-xs text-white/30">
                        Ends
                      </p>

                      <p className="mt-1 text-sm font-medium text-white/70">
                        {formatDate(eventEnd)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                    <p className="text-sm font-medium leading-6 text-[#b7ffe3]">
                      {eventType === "paid"
                        ? "The upfront payment secures the reservation. After attendance is confirmed, the remaining balance becomes due."
                        : "Attend or cancel on time and the full commitment deposit returns."}
                    </p>
                  </div>

                  <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                    <p className="text-xs text-white/30">
                      ShowUp V3 contract
                    </p>

                    <p className="mt-1 break-all font-mono text-xs leading-5 text-white/55">
                      0x81a14301ADb2c8DA38dbd7d8Fa05eF940115FfBD
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
