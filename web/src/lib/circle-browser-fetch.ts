const CIRCLE_STABLECOIN_ORIGIN =
  "https://api.circle.com";

const CIRCLE_STABLECOIN_PATH =
  "/v1/stablecoinKits/";

function isCircleStablecoinRequest(
  input: RequestInfo | URL,
) {
  const rawUrl =
    input instanceof Request
      ? input.url
      : input.toString();

  try {
    const url = new URL(
      rawUrl,
      window.location.href,
    );

    return (
      url.origin ===
        CIRCLE_STABLECOIN_ORIGIN &&
      url.pathname.startsWith(
        CIRCLE_STABLECOIN_PATH,
      )
    );
  } catch {
    return false;
  }
}

function mergeRequestHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const headers = new Headers(
    input instanceof Request
      ? input.headers
      : undefined,
  );

  if (init?.headers) {
    new Headers(init.headers).forEach(
      (value, key) => {
        headers.set(key, value);
      },
    );
  }

  headers.delete("x-user-agent");

  return headers;
}

export async function withCircleBrowserFetch<
  TResult,
>(
  operation: () => Promise<TResult>,
): Promise<TResult> {
  if (typeof window === "undefined") {
    return operation();
  }

  const originalFetch = window.fetch;

  window.fetch = async (
    input,
    init,
  ) => {
    if (
      !isCircleStablecoinRequest(input)
    ) {
      return originalFetch.call(
        window,
        input,
        init,
      );
    }

    return originalFetch.call(
      window,
      input,
      {
        ...init,
        headers: mergeRequestHeaders(
          input,
          init,
        ),
      },
    );
  };

  try {
    return await operation();
  } finally {
    window.fetch = originalFetch;
  }
}
