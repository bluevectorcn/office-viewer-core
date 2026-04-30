import {
  handleSaveLikeRequest,
  shouldInterceptUrl,
} from "../../application/handlers/SaveCommandHandler";
import {
  handleImageUploadRequest,
  shouldInterceptImageUploadUrl,
} from "../../application/handlers/ImageUploadCommandHandler";

const endpointPatchedWindows = new WeakSet<Window>();
const endpointPatchKey = "__ooLocalEndpointPatch";

function setReadonly(xhr: XMLHttpRequest, key: keyof XMLHttpRequest, value: unknown) {
  try {
    Object.defineProperty(xhr, key, {
      configurable: true,
      enumerable: true,
      get: () => value,
    });
  } catch {
    try {
      (xhr as any)[key] = value;
    } catch {
      // Ignore assignment failures on read-only properties.
    }
  }
}

function setXhrResponse(xhr: XMLHttpRequest, responseText: string) {
  setReadonly(xhr, "readyState", 4);
  setReadonly(xhr, "status", 200);
  setReadonly(xhr, "statusText", "OK");
  setReadonly(xhr, "responseText", responseText);
  setReadonly(xhr, "response", responseText);

  xhr.getAllResponseHeaders = () => "content-type: application/json\r\n";
  xhr.getResponseHeader = (name: string) =>
    name.toLowerCase() === "content-type" ? "application/json" : null;
}

async function getRequestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (init && "body" in init) {
    return init.body;
  }
  if (input && typeof input === "object" && "clone" in input && "headers" in input) {
    const cloned = input.clone();
    const contentType = cloned.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("multipart/form-data")) {
      return cloned.formData();
    }
    if (contentType.includes("application/json") || contentType.startsWith("text/")) {
      return cloned.text();
    }
    return cloned.blob();
  }
  return undefined;
}

function dispatchXhrEvent(xhr: XMLHttpRequest, type: string) {
  try {
    xhr.dispatchEvent(new ProgressEvent(type));
  } catch {
    const handler = (xhr as unknown as Record<string, unknown>)[`on${type}`];
    if (typeof handler === "function") {
      handler.call(xhr, new ProgressEvent(type));
    }
  }
}

export function installLocalEndpointPatch(targetWindow: Window) {
  const marker = targetWindow as Window & { [endpointPatchKey]?: boolean };
  if (endpointPatchedWindows.has(targetWindow) || marker[endpointPatchKey]) return;
  marker[endpointPatchKey] = true;
  endpointPatchedWindows.add(targetWindow);

  const fetchRef = targetWindow.fetch?.bind(targetWindow);
  if (fetchRef) {
    targetWindow.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (shouldInterceptImageUploadUrl(targetWindow, url)) {
        const body = await getRequestBody(input, init);
        const result = await handleImageUploadRequest(targetWindow, url, body);
        if (result) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }
      }
      if (shouldInterceptUrl(targetWindow, url)) {
        const body = await getRequestBody(input, init);
        const result = await handleSaveLikeRequest(targetWindow, url, body);
        if (result) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }
      }
      return fetchRef(input, init);
    }) as typeof targetWindow.fetch;
  }

  const OriginalXHR = (targetWindow as unknown as typeof globalThis).XMLHttpRequest as
    | typeof XMLHttpRequest
    | undefined;
  if (!OriginalXHR) {
    return;
  }

  const open = OriginalXHR.prototype.open;
  const send = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function patchedOpen(
    this: XMLHttpRequest & { __ooUrl?: string },
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    const urlString = typeof url === "string" ? url : url.href;
    this.__ooUrl = urlString;
    return open.call(this, method, urlString, async ?? true, username, password);
  };

  OriginalXHR.prototype.send = function patchedSend(
    this: XMLHttpRequest & { __ooUrl?: string },
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    const url = this.__ooUrl;
    if (
      !url ||
      (!shouldInterceptUrl(targetWindow, url) && !shouldInterceptImageUploadUrl(targetWindow, url))
    ) {
      return send.call(this, body);
    }

    void (async () => {
      try {
        const result = shouldInterceptImageUploadUrl(targetWindow, url)
          ? await handleImageUploadRequest(targetWindow, url, body)
          : await handleSaveLikeRequest(targetWindow, url, body);
        if (!result) {
          send.call(this, body);
          return;
        }
        const responseText = JSON.stringify(result);
        setXhrResponse(this, responseText);
        queueMicrotask(() => {
          dispatchXhrEvent(this, "readystatechange");
          dispatchXhrEvent(this, "load");
          dispatchXhrEvent(this, "loadend");
        });
      } catch (error) {
        console.error("Local save handler failed", error);
        send.call(this, body);
      }
    })();
  };
}
