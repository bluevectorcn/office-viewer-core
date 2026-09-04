import { describe, it, expect, vi } from "vitest";
import { injectGlobals } from "@/application/initialization/GlobalInjector";

describe("GlobalInjector installSaveWithPartsPatch", () => {
  it("wraps AscCommon.saveWithParts and ensures fCallback is called when fCallbackRequest is absent", () => {
    const fakeWindow: any = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      parent: {},
      location: { href: "http://localhost/" },
    };

    let innerSendCommand: any;
    const originalSaveWithParts = vi.fn((fSendCommand, fCallback, fCallbackRequest, oAdditionalData, dataContainer) => {
      innerSendCommand = (response: any) => {
        // 模拟 OnlyOffice 原版有缺陷的逻辑：
        if (fCallbackRequest) {
          fCallbackRequest(response, 200);
        }
      };
    });

    fakeWindow.AscCommon = {
      saveWithParts: originalSaveWithParts,
    };

    injectGlobals(fakeWindow);

    const fSendCommand = vi.fn();
    const fCallback = vi.fn();

    fakeWindow.AscCommon.saveWithParts(fSendCommand, fCallback, undefined, {}, { index: 1, count: 1 });

    expect(originalSaveWithParts).toHaveBeenCalled();

    // 触发内部成功回调
    innerSendCommand({ status: "ok", data: { "output.bin": "blob:fake" } });

    // 验证：通过 patch，即使 fCallbackRequest 为 undefined，fCallback 也会被正常执行！
    expect(fCallback).toHaveBeenCalledWith({ status: "ok", data: { "output.bin": "blob:fake" } }, 200);
  });
});
