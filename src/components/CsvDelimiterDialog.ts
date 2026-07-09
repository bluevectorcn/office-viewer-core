import { t } from "../shared/i18n/I18nManager";

export interface CsvOptions {
  delimiter: number;
  delimiterChar: string;
  encoding?: number; // 0 or undefined means auto-detect
}

export function showCsvDelimiterDialog(): Promise<CsvOptions> {
  return new Promise<CsvOptions>((resolve) => {
    if (typeof document === "undefined") {
      resolve({ delimiter: 4, delimiterChar: ",", encoding: 0 });
      return;
    }

    // 1. 创建遮罩
    const overlay = document.createElement("div");
    overlay.className = "csv-dialog-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(74, 62, 61, 0.35);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      opacity: 0;
      transition: opacity 0.25s ease;
    `;

    // 2. 对话框卡片
    const dialog = document.createElement("div");
    dialog.className = "csv-dialog";
    dialog.style.cssText = `
      background: rgba(245, 241, 234, 0.96);
      border: 1px solid rgba(140, 126, 123, 0.25);
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(74, 62, 61, 0.18);
      width: 420px;
      max-width: 90%;
      padding: 28px;
      transform: translateY(20px);
      opacity: 0;
      transition: transform 0.25s ease, opacity 0.25s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-sizing: border-box;
    `;

    // 3. 标题
    const title = document.createElement("h3");
    title.innerText = t("csv_delimiter_title");
    title.style.cssText = `
      margin: 0 0 8px 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: #4a3e3d;
    `;

    // 4. 描述
    const desc = document.createElement("p");
    desc.innerText = t("csv_delimiter_desc");
    desc.style.cssText = `
      margin: 0 0 20px 0;
      font-size: 0.875rem;
      color: #8c7e7b;
      line-height: 1.5;
    `;

    // 5. 选项容器
    const optionsContainer = document.createElement("div");
    optionsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;

    // 候选分隔符列表
    const candidates = [
      { label: t("csv_delimiter_comma"), delimiter: 4, char: "," },
      { label: t("csv_delimiter_semicolon"), delimiter: 2, char: ";" },
      { label: t("csv_delimiter_tab"), delimiter: 1, char: "\t" },
      { label: t("csv_delimiter_space"), delimiter: 0, char: " " },
      { label: t("csv_delimiter_colon"), delimiter: 3, char: ":" },
    ];

    let selectedDelimiterIndex = 0; // 默认选中逗号

    const optionElements: HTMLElement[] = [];

    candidates.forEach((cand, idx) => {
      const opt = document.createElement("div");
      opt.style.cssText = `
        border: 1.5px solid rgba(140, 126, 123, 0.3);
        border-radius: 10px;
        padding: 14px 18px;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 0.95rem;
        font-weight: 500;
        color: #615251;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-sizing: border-box;
      `;
      opt.innerText = cand.label;

      // 单选小圆点样式
      const radioDot = document.createElement("div");
      radioDot.style.cssText = `
        width: 18px;
        height: 18px;
        border: 2px solid #b0a4a2;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        box-sizing: border-box;
      `;
      const radioInner = document.createElement("div");
      radioInner.style.cssText = `
        width: 8px;
        height: 8px;
        background: transparent;
        border-radius: 50%;
        transition: all 0.2s ease;
        box-sizing: border-box;
      `;
      radioDot.appendChild(radioInner);
      opt.appendChild(radioDot);

      const updateSelectionStyles = () => {
        if (selectedDelimiterIndex === idx) {
          opt.style.borderColor = "#df6c2b";
          opt.style.backgroundColor = "rgba(223, 108, 43, 0.08)";
          opt.style.color = "#df6c2b";
          radioDot.style.borderColor = "#df6c2b";
          radioInner.style.backgroundColor = "#df6c2b";
        } else {
          opt.style.borderColor = "rgba(140, 126, 123, 0.3)";
          opt.style.backgroundColor = "#fcfbfa";
          opt.style.color = "#615251";
          radioDot.style.borderColor = "#b0a4a2";
          radioInner.style.backgroundColor = "transparent";
        }
      };

      opt.addEventListener("click", () => {
        selectedDelimiterIndex = idx;
        optionElements.forEach((el) => {
          el.dispatchEvent(new CustomEvent("selection-change"));
        });
      });

      opt.addEventListener("selection-change", updateSelectionStyles);

      opt.addEventListener("mouseenter", () => {
        if (selectedDelimiterIndex !== idx) {
          opt.style.borderColor = "rgba(140, 126, 123, 0.5)";
          opt.style.backgroundColor = "#f7f4ee";
        }
      });
      opt.addEventListener("mouseleave", () => {
        if (selectedDelimiterIndex !== idx) {
          opt.style.borderColor = "rgba(140, 126, 123, 0.3)";
          opt.style.backgroundColor = "#fcfbfa";
        }
      });

      updateSelectionStyles();
      optionsContainer.appendChild(opt);
      optionElements.push(opt);
    });

    // 6. 高级选项折叠菜单 (编码选择)
    const advContainer = document.createElement("div");
    advContainer.style.cssText = `
      margin-top: 18px;
      border-top: 1px dashed rgba(140, 126, 123, 0.25);
      padding-top: 12px;
      display: flex;
      flex-direction: column;
    `;

    const advToggle = document.createElement("button");
    advToggle.style.cssText = `
      background: none;
      border: none;
      color: #8c7e7b;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 0;
      align-self: flex-start;
      outline: none;
    `;
    
    // 箭头的 svg
    const arrowSvg = `
      <svg class="csv-adv-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease;">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;
    advToggle.innerHTML = `${arrowSvg}<span>${t("csv_delimiter_encoding")}</span>`;

    const advContent = document.createElement("div");
    advContent.style.cssText = `
      display: none;
      margin-top: 8px;
      transition: all 0.2s ease;
    `;

    const label = document.createElement("label");
    label.innerText = t("csv_delimiter_encoding");
    label.style.cssText = `
      font-size: 0.8rem;
      font-weight: 600;
      color: #615251;
      margin-bottom: 6px;
      display: block;
    `;

    const select = document.createElement("select");
    select.style.cssText = `
      width: 100%;
      padding: 10px 12px;
      border: 1.5px solid rgba(140, 126, 123, 0.3);
      border-radius: 8px;
      font-size: 0.9rem;
      color: #615251;
      background-color: #fcfbfa;
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s ease;
      box-sizing: border-box;
    `;
    select.addEventListener("mouseenter", () => {
      select.style.borderColor = "#df6c2b";
    });
    select.addEventListener("mouseleave", () => {
      select.style.borderColor = "rgba(140, 126, 123, 0.3)";
    });

    const encodings = [
      { label: t("csv_delimiter_encoding_auto"), value: 0 },
      { label: "UTF-8 (UTF-8)", value: 65001 },
      { label: "GBK (Chinese GBK)", value: 936 },
      { label: "UTF-16LE (Unicode LE)", value: 1200 },
      { label: "UTF-16BE (Unicode BE)", value: 1201 },
      { label: "Windows-1252 (Western European)", value: 1252 },
    ];

    encodings.forEach((enc) => {
      const opt = document.createElement("option");
      opt.value = String(enc.value);
      opt.innerText = enc.label;
      select.appendChild(opt);
    });

    advContent.appendChild(label);
    advContent.appendChild(select);
    advContainer.appendChild(advToggle);
    advContainer.appendChild(advContent);

    let isExpanded = false;
    advToggle.addEventListener("click", () => {
      isExpanded = !isExpanded;
      const arrow = advToggle.querySelector(".csv-adv-arrow") as HTMLElement;
      if (isExpanded) {
        advContent.style.display = "block";
        arrow.style.transform = "rotate(90deg)";
      } else {
        advContent.style.display = "none";
        arrow.style.transform = "rotate(0deg)";
      }
    });

    // 7. 确认按钮
    const confirmBtn = document.createElement("button");
    confirmBtn.innerText = t("csv_delimiter_confirm");
    confirmBtn.style.cssText = `
      background: #df6c2b;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      padding: 14px 24px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      margin-top: 24px;
      transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
      box-shadow: 0 4px 12px rgba(223, 108, 43, 0.25);
      box-sizing: border-box;
    `;

    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.background = "#c9591d";
      confirmBtn.style.boxShadow = "0 6px 16px rgba(223, 108, 43, 0.35)";
    });
    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.background = "#df6c2b";
      confirmBtn.style.boxShadow = "0 4px 12px rgba(223, 108, 43, 0.25)";
    });
    confirmBtn.addEventListener("mousedown", () => {
      confirmBtn.style.transform = "scale(0.98)";
    });
    confirmBtn.addEventListener("mouseup", () => {
      confirmBtn.style.transform = "none";
    });

    const closeDialog = () => {
      overlay.style.opacity = "0";
      dialog.style.transform = "translateY(20px)";
      dialog.style.opacity = "0";
      setTimeout(() => {
        document.body.removeChild(overlay);
      }, 250);
    };

    confirmBtn.addEventListener("click", () => {
      const selected = candidates[selectedDelimiterIndex];
      const encodingVal = Number(select.value);
      closeDialog();
      resolve({
        delimiter: selected.delimiter,
        delimiterChar: selected.char,
        encoding: encodingVal === 0 ? undefined : encodingVal,
      });
    });

    dialog.appendChild(title);
    dialog.appendChild(desc);
    dialog.appendChild(optionsContainer);
    dialog.appendChild(advContainer);
    dialog.appendChild(confirmBtn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 进场动画
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      dialog.style.transform = "translateY(0)";
      dialog.style.opacity = "1";
    });
  });
}
