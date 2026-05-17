// ==UserScript==
// @name         Reddit 中文翻译
// @name:en      Reddit Chinese Translator
// @namespace    https://github.com/dason-zou/Reddit-CN-Translator
// @version      1.0.0
// @description  在新版 Reddit（www.reddit.com）帖子标题、正文与评论旁添加「翻译成中文」按钮；支持单条翻译、全帖批量翻译与显示原文切换。已含中文的内容不显示按钮，代码块不翻译。支持多个非官方翻译接口，文本会发送到所选翻译服务，可能受限流或失效。不支持 old.reddit。
// @description:en  Adds translate buttons on new Reddit (www.reddit.com) post titles, bodies, and comments. Per-item and full-post translation with show-original toggle. Skips Chinese text and code blocks. Supports multiple unofficial translation APIs (text sent to the selected provider). Does not support old.reddit.
// @match        https://www.reddit.com/*
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// @connect      translate.google.com
// @connect      www.bing.com
// @connect      cn.bing.com
// @connect      transmart.qq.com
// @connect      www2.deepl.com
// @supportURL   https://github.com/dason-zou/Reddit-CN-Translator/issues
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';
  
    const MAX_TRANSLATE_CHARS = 1200;
    const BTN_TEXT_TRANSLATE = '翻译成中文';
    const BTN_TEXT_LOADING = '正在翻译...';
    const BTN_TEXT_ORIGINAL = '显示原文';
    const BTN_TEXT_RETRY = '翻译失败，点击重试';
    const BTN_TEXT_TRANSLATE_ALL = '全帖翻译';
    const BTN_TEXT_TRANSLATE_ALL_STOP = '翻译中，停止翻译';
    const BTN_TEXT_TRANSLATE_ALL_STOPPING = '正在停止...';
    const TRANSLATE_ALL_BUTTON_ID = 'reddit-zh-translator-all-btn';
    const SETTINGS_BUTTON_ID = 'reddit-zh-translator-settings-btn';
    const SETTINGS_MENU_ID = 'reddit-zh-translator-settings-menu';
    const SETTINGS_STORAGE_KEY = 'reddit-zh-translator-api';
    const TARGET_LANG_STORAGE_KEY = 'reddit-zh-translator-target-lang';
    const AUTO_TRANSLATE_ALL_STORAGE_KEY = 'reddit-zh-translator-auto-all';
    const DEBUG_STORAGE_KEY = 'reddit-zh-translator-debug';
    const TRANSLATE_CACHE_PREFIX = 'reddit-zh-translator-cache';
    const TRANSLATE_API_AUTO = 'auto';
    const TARGET_LANGS = {
      zhCN: {
        label: '简体中文',
        cacheKey: 'zh-CN',
        google: 'zh-CN',
        googleMobile: 'zh-CN',
        tencentAi: 'zh',
        bing: 'zh-Hans',
        deepl: 'ZH'
      },
      zhTW: {
        label: '繁體中文',
        cacheKey: 'zh-TW',
        google: 'zh-TW',
        googleMobile: 'zh-TW',
        tencentAi: 'zh-TW',
        bing: 'zh-Hant',
        deepl: 'ZH'
      }
    };
    const TRANSLATE_APIS = {
      auto: '自动选择',
      google: '谷歌翻译',
      googleMobile: '谷歌翻译（移动版）',
      tencentAi: '腾讯 AI 翻译',
      deepl: 'DeepL 翻译',
      bing: '必应翻译'
    };
    const TRANSLATE_API_FALLBACK_ORDER = ['google', 'tencentAi', 'deepl', 'googleMobile'];
    const BING_TRANSLATOR_PAGE_URL = 'https://cn.bing.com/translator';
    const BING_TRANSLATOR_IID = 'translator.5025';
  
    const CONTENT_SELECTORS = [
      'shreddit-post [slot="title"]',
      'h1[slot="title"]',
      'a[id^="post-title"]',
      'shreddit-post-text-body .md[id^="t3_"][id$="-post-rtjson-content"]',
      'div[shreddit-comment-content]',
      'shreddit-comment .md[slot="comment"]'
    ].join(',');
  
    const stateMap = new WeakMap();
    const pendingSet = new WeakSet();
    const buttonTargetMap = new WeakMap();
    let translateAllSession = null;
    let translateAllButton = null;
    let settingsButton = null;
    let settingsMenu = null;
    let selectedTranslateApi = getStoredTranslateApi();
    let selectedTargetLanguage = getStoredTargetLanguage();
    let autoTranslateAllEnabled = getStoredAutoTranslateAll();
    let autoTranslateAllPath = null;
    let autoTranslateAllTimer = null;
    let bingAuth = null;
  
    addStyle();
    addTranslateAllButton();
    addSettingsButton();
    watchRouteChange();
  
    function addStyle() {
      const style = document.createElement('style');
      style.textContent = `
        .reddit-zh-translator-wrap {
          display: block;
          position: relative;
          z-index: 2;
          margin: 0.35em 0 0.65em;
          line-height: 1.2;
          pointer-events: auto;
        }

        .reddit-zh-translator-wrap--comment,
        .reddit-zh-translator-wrap--title,
        .reddit-zh-translator-wrap--post-body {
          margin-top: 0rem;
          margin-bottom: 0rem;
        }

        .reddit-zh-translator-wrap--comment {
          margin-left: 0.5rem;
        }

        .reddit-zh-translator-wrap--post-title-detail {
          padding-inline: 1rem;
        }

        @media (min-width: 480px) {
          .reddit-zh-translator-wrap--post-title-detail {
            padding-inline: 0;
          }
        }
  
        .reddit-zh-translator-btn {
          display: inline;
          padding: 0;
          border: 0;
          background: transparent;
          color: rgb(129, 140, 153);
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          line-height: 1;
          cursor: pointer;
          pointer-events: auto;
        }
  
        .reddit-zh-translator-btn:hover {
          color: rgb(215, 218, 220);
          text-decoration: underline;
        }
  
        .reddit-zh-translator-btn:disabled {
          opacity: 0.7;
          cursor: default;
          text-decoration: none;
        }
  
        .reddit-zh-translated-text {
          margin: 0;
          white-space: pre-wrap;
        }

        .reddit-zh-translator-all-btn {
          position: fixed;
          right: 32px;
          bottom: 32px;
          z-index: 9999;
          padding: 8px 12px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          background: rgb(26, 26, 27);
          color: rgb(215, 218, 220);
          font-size: 13px;
          font-weight: 600;
          line-height: 1.2;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          cursor: pointer;
        }

        .reddit-zh-translator-all-btn:hover {
          background: rgb(39, 39, 41);
        }

        .reddit-zh-translator-all-btn:disabled {
          opacity: 0.75;
          cursor: default;
        }

        .reddit-zh-translator-settings-btn {
          position: fixed;
          right: 32px;
          bottom: 78px;
          z-index: 9999;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          padding: 0;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          background: rgb(26, 26, 27);
          color: rgb(215, 218, 220);
          line-height: 1;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          cursor: pointer;
        }

        .reddit-zh-translator-settings-btn:hover {
          background: rgb(39, 39, 41);
        }

        .reddit-zh-translator-settings-btn svg {
          width: 18px;
          height: 18px;
          stroke: currentColor;
        }

        .reddit-zh-translator-settings-menu {
          position: fixed;
          right: 32px;
          bottom: 120px;
          z-index: 10000;
          min-width: 180px;
          padding: 8px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 12px;
          background: rgb(26, 26, 27);
          color: rgb(215, 218, 220);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }

        .reddit-zh-translator-settings-title {
          padding: 4px 8px 8px;
          color: rgb(129, 140, 153);
          font-size: 12px;
          font-weight: 600;
        }

        .reddit-zh-translator-lang-toggle {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2px;
          margin: 0 0 8px;
          padding: 3px;
          border-radius: 999px;
          background: rgb(39, 39, 41);
        }

        .reddit-zh-translator-lang-toggle-option {
          padding: 6px 10px;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: rgb(129, 140, 153);
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .reddit-zh-translator-lang-toggle-option[aria-checked="true"] {
          background: rgb(215, 218, 220);
          color: rgb(26, 26, 27);
        }

        .reddit-zh-translator-settings-switch {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
          margin: 0 0 8px;
          padding: 8px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }

        .reddit-zh-translator-settings-switch:hover {
          background: rgb(39, 39, 41);
        }

        .reddit-zh-translator-settings-switch-track {
          position: relative;
          flex: 0 0 auto;
          width: 36px;
          height: 20px;
          border-radius: 999px;
          background: rgb(80, 80, 82);
        }

        .reddit-zh-translator-settings-switch-track::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: rgb(215, 218, 220);
          transition: transform 0.15s ease;
        }

        .reddit-zh-translator-settings-switch[aria-checked="true"] .reddit-zh-translator-settings-switch-track {
          background: rgb(0, 121, 211);
        }

        .reddit-zh-translator-settings-switch[aria-checked="true"] .reddit-zh-translator-settings-switch-track::after {
          transform: translateX(16px);
        }

        .reddit-zh-translator-settings-option {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 13px;
          text-align: left;
          cursor: pointer;
        }

        .reddit-zh-translator-settings-option:hover {
          background: rgb(39, 39, 41);
        }

        .reddit-zh-translator-settings-check {
          width: 1em;
          color: rgb(129, 140, 153);
        }
  
      `;
      document.documentElement.appendChild(style);
    }

    function addTranslateAllButton() {
      document.querySelectorAll(`#${TRANSLATE_ALL_BUTTON_ID}, .reddit-zh-translator-all-btn`)
        .forEach(button => button.remove());

      const btn = document.createElement('button');
      translateAllButton = btn;
      btn.id = TRANSLATE_ALL_BUTTON_ID;
      btn.className = 'reddit-zh-translator-all-btn';
      btn.type = 'button';
      btn.textContent = BTN_TEXT_TRANSLATE_ALL;

      btn.addEventListener('click', async () => {
        if (!isPostPage()) return;

        if (translateAllSession) {
          translateAllSession.stopped = true;
          translateAllSession.abortCurrent?.();
          btn.disabled = true;
          btn.textContent = BTN_TEXT_TRANSLATE_ALL_STOPPING;
          return;
        }

        const session = {
          stopped: false,
          abortCurrent: null
        };
        translateAllSession = session;
        btn.textContent = BTN_TEXT_TRANSLATE_ALL_STOP;

        try {
          await translateAll(session);
        } finally {
          if (translateAllSession === session) {
            translateAllSession = null;
          }
          btn.disabled = false;
          btn.textContent = BTN_TEXT_TRANSLATE_ALL;
        }
      });

      document.documentElement.appendChild(btn);
      updateTranslateAllButtonVisibility();
    }

    function addSettingsButton() {
      document.querySelectorAll(`#${SETTINGS_BUTTON_ID}, #${SETTINGS_MENU_ID}, .reddit-zh-translator-settings-btn, .reddit-zh-translator-settings-menu`)
        .forEach(element => element.remove());

      const btn = document.createElement('button');
      settingsButton = btn;
      btn.id = SETTINGS_BUTTON_ID;
      btn.className = 'reddit-zh-translator-settings-btn';
      btn.type = 'button';
      btn.title = '翻译设置';
      btn.setAttribute('aria-label', '翻译设置');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 0 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 0 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z"></path>
        </svg>
      `;

      const menu = document.createElement('div');
      settingsMenu = menu;
      menu.id = SETTINGS_MENU_ID;
      menu.className = 'reddit-zh-translator-settings-menu';
      menu.hidden = true;
      menu.style.display = 'none';
      renderSettingsMenu();

      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSettingsMenu();
      });

      document.addEventListener('click', (event) => {
        if (
          settingsMenu?.hidden ||
          settingsMenu?.contains(event.target) ||
          settingsButton?.contains(event.target)
        ) {
          return;
        }

        closeSettingsMenu();
      });

      document.documentElement.appendChild(menu);
      document.documentElement.appendChild(btn);
      updateTranslateAllButtonVisibility();
    }

    function renderSettingsMenu() {
      if (!settingsMenu) return;

      settingsMenu.innerHTML = '';

      renderTargetLanguageToggle();
      renderAutoTranslateAllSwitch();

      renderSettingsMenuSection('翻译 API', TRANSLATE_APIS, selectedTranslateApi, (api) => {
        selectedTranslateApi = api;
        localStorage.setItem(SETTINGS_STORAGE_KEY, api);
        renderSettingsMenu();
        closeSettingsMenu();
      });
    }

    function renderTargetLanguageToggle() {
      const title = document.createElement('div');
      title.className = 'reddit-zh-translator-settings-title';
      title.textContent = '目标语言';
      settingsMenu.appendChild(title);

      const toggle = document.createElement('div');
      toggle.className = 'reddit-zh-translator-lang-toggle';
      toggle.setAttribute('role', 'radiogroup');
      toggle.setAttribute('aria-label', '目标语言');

      Object.entries(TARGET_LANGS).forEach(([targetLanguage, config]) => {
        const option = document.createElement('button');
        option.className = 'reddit-zh-translator-lang-toggle-option';
        option.type = 'button';
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(selectedTargetLanguage === targetLanguage));
        option.textContent = config.label;

        option.addEventListener('click', () => {
          if (selectedTargetLanguage === targetLanguage) return;

          selectedTargetLanguage = targetLanguage;
          localStorage.setItem(TARGET_LANG_STORAGE_KEY, targetLanguage);
          resetTranslations();
          renderSettingsMenu();
          scan();
        });

        toggle.appendChild(option);
      });

      settingsMenu.appendChild(toggle);
    }

    function renderAutoTranslateAllSwitch() {
      const button = document.createElement('button');
      button.className = 'reddit-zh-translator-settings-switch';
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', String(autoTranslateAllEnabled));

      const label = document.createElement('span');
      label.textContent = '默认全帖翻译';

      const track = document.createElement('span');
      track.className = 'reddit-zh-translator-settings-switch-track';
      track.setAttribute('aria-hidden', 'true');

      button.append(label, track);
      button.addEventListener('click', () => {
        autoTranslateAllEnabled = !autoTranslateAllEnabled;
        localStorage.setItem(AUTO_TRANSLATE_ALL_STORAGE_KEY, autoTranslateAllEnabled ? '1' : '0');
        button.setAttribute('aria-checked', String(autoTranslateAllEnabled));

        if (autoTranslateAllEnabled) {
          scheduleAutoTranslateAll();
        }
      });

      settingsMenu.appendChild(button);
    }

    function renderSettingsMenuSection(titleText, options, selectedValue, onSelect) {
      const title = document.createElement('div');
      title.className = 'reddit-zh-translator-settings-title';
      title.textContent = titleText;
      settingsMenu.appendChild(title);
 
      Object.entries(options).forEach(([value, optionConfig]) => {
        const label = typeof optionConfig === 'string' ? optionConfig : optionConfig.label;
        const option = document.createElement('button');
        option.className = 'reddit-zh-translator-settings-option';
        option.type = 'button';
        option.setAttribute('role', 'menuitemradio');
        option.setAttribute('aria-checked', String(selectedValue === value));
        option.dataset.settingsValue = value;

        const check = document.createElement('span');
        check.className = 'reddit-zh-translator-settings-check';
        check.textContent = selectedValue === value ? '✓' : '';

        const text = document.createElement('span');
        text.textContent = label;

        option.append(check, text);
        option.addEventListener('click', () => onSelect(value));

        settingsMenu.appendChild(option);
      });
    }

    function toggleSettingsMenu() {
      if (!settingsMenu) return;

      if (settingsMenu.hidden) {
        settingsMenu.hidden = false;
        settingsMenu.style.display = 'block';
      } else {
        closeSettingsMenu();
      }
    }

    function closeSettingsMenu() {
      if (!settingsMenu) return;

      settingsMenu.hidden = true;
      settingsMenu.style.display = 'none';
    }

    function getStoredTranslateApi() {
      const api = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return Object.hasOwn(TRANSLATE_APIS, api) ? api : TRANSLATE_API_AUTO;
    }

    function getStoredTargetLanguage() {
      const targetLanguage = localStorage.getItem(TARGET_LANG_STORAGE_KEY);
      return Object.hasOwn(TARGET_LANGS, targetLanguage) ? targetLanguage : 'zhCN';
    }

    function getStoredAutoTranslateAll() {
      return localStorage.getItem(AUTO_TRANSLATE_ALL_STORAGE_KEY) === '1';
    }

    function getTargetLanguageConfig() {
      return TARGET_LANGS[selectedTargetLanguage] || TARGET_LANGS.zhCN;
    }

    function updateTranslateAllButtonVisibility() {
      const shouldShowTranslateAll = isPostPage();
      if (!shouldShowTranslateAll) {
        autoTranslateAllPath = null;
        clearTimeout(autoTranslateAllTimer);
        autoTranslateAllTimer = null;
      }

      if (translateAllButton) {
        translateAllButton.hidden = !shouldShowTranslateAll;
        translateAllButton.style.display = shouldShowTranslateAll ? 'block' : 'none';
      }

      if (settingsButton) {
        settingsButton.hidden = false;
        settingsButton.style.display = 'inline-flex';
      }

      if (!shouldShowTranslateAll && translateAllSession) {
        translateAllSession.stopped = true;
        translateAllSession.abortCurrent?.();
      }
    }

    function watchRouteChange() {
      const notifyRouteChange = () => setTimeout(() => {
        updateTranslateAllButtonVisibility();
        scan();
      }, 0);

      ['pushState', 'replaceState'].forEach((method) => {
        const original = history[method];
        history[method] = function (...args) {
          const result = original.apply(this, args);
          notifyRouteChange();
          return result;
        };
      });

      window.addEventListener('popstate', notifyRouteChange);
    }
  
    function getText(el) {
      return (el.innerText || el.textContent || '').trim();
    }
  
    function getTranslateTarget(el) {
      if (el.matches('.md[slot="comment"], div[shreddit-comment-content]')) {
        return (
          el.querySelector(':scope > div[id$="-post-rtjson-content"]') ||
          el.querySelector(':scope > div') ||
          el
        );
      }
  
      return el;
    }
  
    function isPostTitle(el) {
      return !!el.closest('shreddit-post') && el.matches('[slot="title"], a[id^="post-title"]');
    }

    function isCommentContent(el) {
      return !!el.closest('shreddit-comment');
    }

    function isPostBodyContent(el) {
      return !!el.closest('shreddit-post-text-body');
    }

    function isPostPage() {
      return /^\/r\/[^/]+\/comments\/[^/]+(?:\/|$)/.test(location.pathname);
    }

    function containsChinese(text) {
      return /[\u3400-\u9FFF]/.test(text);
    }

    function containsJapaneseKana(text) {
      return /[\u3040-\u30FF]/.test(text);
    }

    function containsSimplifiedChinese(text) {
      return /[汉语门马龙云后发东车书见长为国过说这时来与对会个们无广风电历丽乐买卖严农刘则刚创办务动医华协单卢卫却厂厅压县参双变叶号叹吓听启吴员问间阳阴阵阶际陆陈页顶须顾领题颜飞饭馆饮饱饰马驰驱验骂鱼鸟鸡鸣麦黄齐齿龄]/.test(text);
    }

    function containsTraditionalChinese(text) {
      return /[漢語門馬龍雲後發東車書見長為國過說這時來與對會個們無廣風電歷麗樂買賣嚴農劉則剛創辦務動醫華協單盧衛卻廠廳壓縣參雙變葉號嘆嚇聽啟吳員問間陽陰陣階際陸陳頁頂須顧領題顏飛飯館飲飽飾馬馳驅驗罵魚鳥雞鳴麥黃齊齒齡]/.test(text);
    }

    function isAlreadyTargetChinese(text) {
      if (!containsChinese(text)) return false;
      if (containsJapaneseKana(text)) return false;

      const hasSimplified = containsSimplifiedChinese(text);
      const hasTraditional = containsTraditionalChinese(text);

      if (selectedTargetLanguage === 'zhTW') {
        return hasTraditional || !hasSimplified;
      }

      return hasSimplified || !hasTraditional;
    }

    function hasTranslatableText(text) {
      return (
        containsChinese(text) ||
        containsJapaneseKana(text) ||
        /[A-Za-z]{2,}/.test(text) ||
        /[\u0400-\u052F\u00C0-\u024F]/.test(text)
      );
    }
  
    function shouldAttach(el) {
      if (!el || el.dataset.zhTranslatorAttached) return false;
      if (el.closest('.reddit-zh-translator-wrap')) return false;
      if (!isPostTitle(el) && !isPostPage()) return false;
  
      const target = getTranslateTarget(el);
      if (!target || target.dataset.zhTranslatorAttached) return false;
      const text = getText(target);
      return hasTranslatableText(text) && !isAlreadyTargetChinese(text);
    }

    function splitText(text) {
      const chunks = [];
      let rest = text;

      while (rest.length > MAX_TRANSLATE_CHARS) {
        const splitAt = Math.max(
          rest.lastIndexOf('\n\n', MAX_TRANSLATE_CHARS),
          rest.lastIndexOf('\n', MAX_TRANSLATE_CHARS),
          rest.lastIndexOf('. ', MAX_TRANSLATE_CHARS),
          rest.lastIndexOf('! ', MAX_TRANSLATE_CHARS),
          rest.lastIndexOf('? ', MAX_TRANSLATE_CHARS)
        );
        const safeSplitAt = splitAt > MAX_TRANSLATE_CHARS * 0.5 ? splitAt + 1 : MAX_TRANSLATE_CHARS;

        chunks.push(rest.slice(0, safeSplitAt));
        rest = rest.slice(safeSplitAt);
      }

      if (rest) chunks.push(rest);
      return chunks;
    }

    function logTranslateDebug(...args) {
      if (localStorage.getItem(DEBUG_STORAGE_KEY) !== '1') return;
      console.warn('[Reddit 中文翻译]', ...args);
    }

    function previewResponse(text) {
      return String(text || '').slice(0, 300);
    }

    function requestText(options, session) {
      if (session?.stopped) return Promise.resolve(null);

      return new Promise((resolve) => {
        const { debugName, ...requestOptions } = options;
        let settled = false;
        let request = null;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (session?.abortCurrent === abort) {
            session.abortCurrent = null;
          }
          resolve(value);
        };
        const abort = () => {
          try {
            request?.abort?.();
          } catch {
            // Ignore abort errors from userscript managers that do not support abort().
          }
          finish(null);
        };

        try {
          request = GM_xmlhttpRequest({
            timeout: 15000,
            ...requestOptions,
            onload(response) {
              const status = Number(response.status) || 200;
              if (status >= 400) {
                logTranslateDebug(`${debugName || 'request'} HTTP ${status}`, {
                  url: requestOptions.url,
                  response: previewResponse(response.responseText)
                });
                finish(null);
                return;
              }
              finish(response.responseText);
            },
            onerror(error) {
              logTranslateDebug(`${debugName || 'request'} network error`, {
                url: requestOptions.url,
                error
              });
              finish(null);
            },
            ontimeout() {
              logTranslateDebug(`${debugName || 'request'} timeout`, {
                url: requestOptions.url
              });
              finish(null);
            },
            onabort() {
              if (!session?.stopped) {
                logTranslateDebug(`${debugName || 'request'} aborted`, {
                  url: requestOptions.url
                });
              }
              finish(null);
            }
          });
        } catch (error) {
          logTranslateDebug(`${debugName || 'request'} failed to start`, {
            url: requestOptions.url,
            error
          });
          finish(null);
        }

        if (session) {
          session.abortCurrent = abort;
          if (session.stopped) abort();
        }
      });
    }

    async function retryTranslate(task, session, retries = 2, debugName = 'translation') {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (session?.stopped) return null;

        try {
          const result = await task();
          if (result) return result;
          logTranslateDebug(`${debugName} returned empty result`, {
            attempt: attempt + 1,
            retries: retries + 1
          });
        } catch (error) {
          logTranslateDebug(`${debugName} parse/runtime error`, {
            attempt: attempt + 1,
            retries: retries + 1,
            error
          });
          // Try the next attempt or fallback provider.
        }
      }

      return null;
    }

    function getTranslationCacheKey(api, text) {
      return `${TRANSLATE_CACHE_PREFIX}:${getTargetLanguageConfig().cacheKey}:${api}:${text}`;
    }

    function getCachedTranslation(api, text) {
      try {
        return sessionStorage.getItem(getTranslationCacheKey(api, text));
      } catch {
        return null;
      }
    }

    function setCachedTranslation(api, text, translatedText) {
      try {
        sessionStorage.setItem(getTranslationCacheKey(api, text), translatedText);
      } catch {
        // Cache failures should not block translation.
      }
    }

    function decodeHtml(text) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
      return textarea.value;
    }

    function parseGoogleTranslateResponse(responseText) {
      const data = JSON.parse(responseText);
      return data?.[0]?.map(item => item?.[0] || '').join('') || null;
    }

    function parseGoogleMobileResponse(responseText) {
      const match = /class="result-container">([\s\S]*?)<\/div>/.exec(responseText);
      return match ? decodeHtml(match[1].trim()) : null;
    }

    function parseBingResponse(responseText) {
      const data = JSON.parse(responseText);
      return data?.[0]?.translations?.[0]?.text || null;
    }

    function parseTencentAiResponse(responseText) {
      const data = JSON.parse(responseText);
      return data?.auto_translation?.[0] || null;
    }

    function parseDeepLResponse(responseText) {
      const data = JSON.parse(responseText);
      return data?.result?.texts?.[0]?.text || null;
    }

    function createUuid() {
      if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
      }

      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const random = Math.random() * 16 | 0;
        const value = char === 'x' ? random : (random & 0x3 | 0x8);
        return value.toString(16);
      });
    }

    function getDeepLTimestamp(text) {
      let timestamp = Date.now();
      const iCount = text.split('i').length - 1;

      if (iCount !== 0) {
        const count = iCount + 1;
        timestamp = timestamp - (timestamp % count) + count;
      }

      return timestamp;
    }

    function parseBingAuth(responseText) {
      const ig = /IG:"([^"]+)"/.exec(responseText)?.[1];
      const abuseParams = /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/.exec(responseText);

      if (!ig || !abuseParams) return null;

      return {
        ig,
        key: abuseParams[1],
        token: abuseParams[2],
        expiresAt: Date.now() + Number(abuseParams[3] || 3600000)
      };
    }

    async function getBingAuth(session) {
      if (bingAuth && bingAuth.expiresAt > Date.now() + 60000) {
        return bingAuth;
      }

      const responseText = await requestText({
        method: 'GET',
        url: BING_TRANSLATOR_PAGE_URL,
        nocache: true,
        debugName: 'bing auth'
      }, session);

      if (!responseText) return null;

      bingAuth = parseBingAuth(responseText);
      if (!bingAuth) {
        logTranslateDebug('bing auth parse returned empty', previewResponse(responseText));
      } else {
        logTranslateDebug('bing auth refreshed', {
          ig: bingAuth.ig,
          key: bingAuth.key,
          tokenPreview: `${bingAuth.token.slice(0, 6)}...${bingAuth.token.slice(-6)}`
        });
      }

      return bingAuth;
    }

    async function translateWithGoogle(text, session) {
      const targetLang = getTargetLanguageConfig().google;
      const url =
        'https://translate.googleapis.com/translate_a/single' +
        '?client=gtx' +
        '&sl=auto' +
        `&tl=${encodeURIComponent(targetLang)}` +
        '&dt=t' +
        `&q=${encodeURIComponent(text)}`;
      const responseText = await requestText({ method: 'GET', url, debugName: 'google' }, session);
      const translated = responseText ? parseGoogleTranslateResponse(responseText) : null;
      if (responseText && !translated) {
        logTranslateDebug('google parse returned empty', previewResponse(responseText));
      }
      return translated;
    }

    async function translateWithGoogleMobile(text, session) {
      const targetLang = getTargetLanguageConfig().googleMobile;
      const url = `https://translate.google.com/m?tl=${encodeURIComponent(targetLang)}&q=${encodeURIComponent(text)}`;
      const responseText = await requestText({
        method: 'GET',
        url,
        anonymous: true,
        nocache: true,
        debugName: 'googleMobile'
      }, session);
      const translated = responseText ? parseGoogleMobileResponse(responseText) : null;
      if (responseText && !translated) {
        logTranslateDebug('googleMobile parse returned empty', previewResponse(responseText));
      }
      return translated;
    }

    async function translateWithTencentAi(text, session) {
      const payload = {
        header: {
          fn: 'auto_translation',
          client_key: `browser-chrome-121.0.0-Windows_10-${createUuid()}-${Date.now()}`,
          session: '',
          user: ''
        },
        type: 'plain',
        model_category: 'normal',
        text_domain: '',
        source: {
          lang: 'auto',
          text_list: [text]
        },
        target: {
          lang: getTargetLanguageConfig().tencentAi
        }
      };
      const responseText = await requestText({
        method: 'POST',
        url: 'https://transmart.qq.com/api/imt',
        data: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://transmart.qq.com',
          'Referer': 'https://transmart.qq.com/'
        },
        anonymous: true,
        nocache: true,
        debugName: 'tencentAi'
      }, session);
      const translated = responseText ? parseTencentAiResponse(responseText) : null;
      if (responseText && !translated) {
        logTranslateDebug('tencentAi parse returned empty', previewResponse(responseText));
      }
      return translated;
    }

    async function translateWithDeepL(text, session) {
      const id = (Math.floor(Math.random() * 99999) + 100000) * 1000;
      const payload = {
        jsonrpc: '2.0',
        method: 'LMT_handle_texts',
        id,
        params: {
          splitting: 'newlines',
          lang: {
            source_lang_user_selected: 'auto',
            target_lang: getTargetLanguageConfig().deepl
          },
          texts: [{
            text,
            requestAlternatives: 3
          }],
          timestamp: getDeepLTimestamp(text)
        }
      };
      let data = JSON.stringify(payload);

      if ((id + 5) % 29 === 0 || (id + 3) % 13 === 0) {
        data = data.replace('"method":"', '"method" : "');
      } else {
        data = data.replace('"method":"', '"method": "');
      }

      const responseText = await requestText({
        method: 'POST',
        url: 'https://www2.deepl.com/jsonrpc',
        data,
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.deepl.com',
          'Referer': 'https://www.deepl.com/'
        },
        anonymous: true,
        nocache: true,
        debugName: 'deepl'
      }, session);
      const translated = responseText ? parseDeepLResponse(responseText) : null;
      if (responseText && !translated) {
        logTranslateDebug('deepl parse returned empty', previewResponse(responseText));
      }
      return translated;
    }

    async function translateWithBing(text, session) {
      const auth = await getBingAuth(session);
      if (session?.stopped || !auth) return null;

      const data = new URLSearchParams({
        fromLang: 'auto-detect',
        to: getTargetLanguageConfig().bing,
        text,
        tryFetchingGenderDebiasedTranslations: 'true',
        token: auth.token,
        key: auth.key
      }).toString();
      const responseText = await requestText({
        method: 'POST',
        url: `https://cn.bing.com/ttranslatev3?isVertical=1&&IG=${encodeURIComponent(auth.ig)}&IID=${encodeURIComponent(BING_TRANSLATOR_IID)}`,
        data,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://cn.bing.com',
          'Referer': BING_TRANSLATOR_PAGE_URL,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        },
        debugName: 'bing'
      }, session);
      const translated = responseText ? parseBingResponse(responseText) : null;
      if (responseText && !translated) {
        logTranslateDebug('bing parse returned empty', previewResponse(responseText));
        if (/"statusCode"\s*:\s*(400|401)/.test(responseText)) {
          bingAuth = null;
        }
      }
      return translated;
    }

    const TRANSLATE_PROVIDERS = {
      google: translateWithGoogle,
      googleMobile: translateWithGoogleMobile,
      tencentAi: translateWithTencentAi,
      deepl: translateWithDeepL,
      bing: translateWithBing
    };

    function getTranslateApiOrder() {
      if (selectedTranslateApi === TRANSLATE_API_AUTO) {
        return TRANSLATE_API_FALLBACK_ORDER;
      }

      return TRANSLATE_PROVIDERS[selectedTranslateApi] ? [selectedTranslateApi] : TRANSLATE_API_FALLBACK_ORDER;
    }

    async function translateChunkWithApi(api, text, session) {
      const cached = getCachedTranslation(api, text);
      if (cached) return cached;

      const retries = selectedTranslateApi === TRANSLATE_API_AUTO ? 0 : 2;
      const translated = await retryTranslate(() => TRANSLATE_PROVIDERS[api](text, session), session, retries, api);
      if (translated) {
        setCachedTranslation(api, text, translated);
      } else {
        logTranslateDebug(`${api} failed, trying next provider if available`, {
          textPreview: text.slice(0, 120)
        });
      }
      return translated;
    }

    async function translateChunk(text, session) {
      if (session?.stopped) return null;

      for (const api of getTranslateApiOrder()) {
        if (session?.stopped) return null;

        const translated = await translateChunkWithApi(api, text, session);
        if (translated) {
          logTranslateDebug(`${api} translated successfully`, {
            textPreview: text.slice(0, 80),
            translatedPreview: translated.slice(0, 80)
          });
          return translated;
        }
      }

      logTranslateDebug('all providers failed for chunk', {
        textPreview: text.slice(0, 120)
      });
      return null;
    }

    async function translateToChinese(text, session) {
      const translatedChunks = [];

      for (const chunk of splitText(text)) {
        if (session?.stopped) return null;

        const translatedChunk = await translateChunk(chunk, session);
        if (!translatedChunk) return null;
        translatedChunks.push(translatedChunk);
      }

      return translatedChunks.join('');
    }
  
    function getTextLayoutElement(target) {
      return (
        Array.from(target.children).find(child =>
          child.tagName === 'DIV' && child.querySelector(':scope > p')
        ) ||
        target
      );
    }

    function createTranslatedContainer(target) {
      const layoutEl = getTextLayoutElement(target);
      const box = document.createElement('div');
      box.dataset.zhTranslatorAttached = '1';
      if (layoutEl.className) {
        box.className = layoutEl.className;
      }
      box.dir = layoutEl.dir || target.dir || 'auto';
      if (target.getAttribute('slot')) {
        box.setAttribute('slot', target.getAttribute('slot'));
      }

      return { box, layoutEl };
    }

    function isCodeBlock(node) {
      return node.nodeType === Node.ELEMENT_NODE && node.matches('pre');
    }

    function createTranslatedBlock(sourceNode, translatedText) {
      if (sourceNode.nodeType !== Node.ELEMENT_NODE) {
        const p = document.createElement('p');
        p.className = 'reddit-zh-translated-text';
        p.textContent = translatedText;
        return p;
      }

      const block = sourceNode.cloneNode(false);
      block.dataset.zhTranslatorAttached = '1';
      block.textContent = translatedText;
      return block;
    }

    async function createTranslatedText(target, session) {
      const { box, layoutEl } = createTranslatedContainer(target);
      let hasTranslatedContent = false;

      for (const child of layoutEl.childNodes) {
        if (session?.stopped) return null;

        if (isCodeBlock(child)) {
          box.appendChild(child.cloneNode(true));
          continue;
        }

        const text = getText(child);
        if (!text) {
          box.appendChild(child.cloneNode(true));
          continue;
        }

        const translatedText = await translateToChinese(text, session);
        if (!translatedText) return null;

        box.appendChild(createTranslatedBlock(child, translatedText));
        hasTranslatedContent = true;
      }

      if (!hasTranslatedContent) return null;
      return box;
    }

    function showTranslation(target, state) {
      if (state.translationEl) {
        target.hidden = true;
        state.translationEl.hidden = false;
        return;
      }

      if (state.translatedText) {
        target.textContent = state.translatedText;
      }
    }

    function showOriginal(target, state) {
      if (state.translationEl) {
        target.hidden = false;
        state.translationEl.hidden = true;
        return;
      }

      if (state.originalText) {
        target.textContent = state.originalText;
      }
    }

    function resetTranslations() {
      document.querySelectorAll('.reddit-zh-translator-btn').forEach((btn) => {
        const target = buttonTargetMap.get(btn);
        if (!target) return;

        const state = stateMap.get(target);
        if (state) {
          showOriginal(target, state);
          state.translationEl?.remove();
          stateMap.delete(target);
        }

        pendingSet.delete(target);
        btn.disabled = false;
        btn.textContent = BTN_TEXT_TRANSLATE;
      });
    }

    function isPendingTranslateButton(btn) {
      return (
        !btn.disabled &&
        (btn.textContent === BTN_TEXT_TRANSLATE || btn.textContent === BTN_TEXT_RETRY)
      );
    }

    async function translateAll(session) {
      scan();

      const buttons = Array.from(document.querySelectorAll('.reddit-zh-translator-btn'))
        .filter(isPendingTranslateButton);

      for (const btn of buttons) {
        if (session?.stopped) break;

        const target = buttonTargetMap.get(btn);
        if (target && isPendingTranslateButton(btn)) {
          await ensureTranslation(target, btn, session);
        }
      }
    }

    function scheduleAutoTranslateAll() {
      if (!autoTranslateAllEnabled || !isPostPage() || translateAllSession) return;
      if (autoTranslateAllPath === location.pathname) return;

      clearTimeout(autoTranslateAllTimer);
      autoTranslateAllTimer = setTimeout(async () => {
        autoTranslateAllTimer = null;
        if (!autoTranslateAllEnabled || !isPostPage() || translateAllSession) return;
        if (autoTranslateAllPath === location.pathname) return;

        const session = {
          stopped: false,
          abortCurrent: null
        };
        autoTranslateAllPath = location.pathname;
        translateAllSession = session;

        if (translateAllButton) {
          translateAllButton.textContent = BTN_TEXT_TRANSLATE_ALL_STOP;
        }

        try {
          await translateAll(session);
        } finally {
          if (translateAllSession === session) {
            translateAllSession = null;
          }
          if (translateAllButton) {
            translateAllButton.disabled = false;
            translateAllButton.textContent = BTN_TEXT_TRANSLATE_ALL;
          }
        }
      }, 500);
    }

    async function ensureTranslation(target, btn, session) {
      const state = stateMap.get(target);

      if (state?.translationEl) {
        showTranslation(target, state);
        state.showingTranslation = true;
        btn.textContent = BTN_TEXT_ORIGINAL;
        return;
      }

      if (pendingSet.has(target)) return;

      const originalText = getText(target);

      if (!originalText) return;

      pendingSet.add(target);
      btn.disabled = true;
      btn.textContent = BTN_TEXT_LOADING;

      try {
        if (isPostTitle(target)) {
          const translatedText = await translateToChinese(originalText, session);

          if (session?.stopped) {
            btn.textContent = BTN_TEXT_TRANSLATE;
            return;
          }

          if (!translatedText) {
            btn.textContent = BTN_TEXT_RETRY;
            return;
          }

          stateMap.set(target, {
            originalText,
            translatedText,
            showingTranslation: true
          });

          target.textContent = translatedText;
          btn.textContent = BTN_TEXT_ORIGINAL;
          return;
        }

        const translationEl = await createTranslatedText(target, session);

        if (session?.stopped) {
          btn.textContent = BTN_TEXT_TRANSLATE;
          return;
        }

        if (!translationEl) {
          btn.textContent = BTN_TEXT_RETRY;
          return;
        }

        target.after(translationEl);

        stateMap.set(target, {
          translationEl,
          showingTranslation: true
        });

        target.hidden = true;

        btn.textContent = BTN_TEXT_ORIGINAL;
      } finally {
        btn.disabled = false;
        pendingSet.delete(target);
      }
    }
  
    async function toggleTranslation(target, btn) {
      const state = stateMap.get(target);
  
      if (state?.showingTranslation) {
        showOriginal(target, state);
        state.showingTranslation = false;
        btn.textContent = BTN_TEXT_TRANSLATE;
        return;
      }
  
      if (state?.translationEl) {
        showTranslation(target, state);
        state.showingTranslation = true;
        btn.textContent = BTN_TEXT_ORIGINAL;
        return;
      }
  
      await ensureTranslation(target, btn);
    }
  
    function attachButton(el) {
      if (!shouldAttach(el)) return;
  
      el.dataset.zhTranslatorAttached = '1';
  
      const target = getTranslateTarget(el);
      target.dataset.zhTranslatorAttached = '1';
  
      const wrap = document.createElement('div');
      wrap.className = 'reddit-zh-translator-wrap';
      if (isCommentContent(el)) {
        wrap.classList.add('reddit-zh-translator-wrap--comment');
      }
      if (isPostTitle(el)) {
        wrap.classList.add('reddit-zh-translator-wrap--title');
        if (el.matches('h1[slot="title"]')) {
          wrap.classList.add('reddit-zh-translator-wrap--post-title-detail');
        }
        wrap.slot = 'title';
      }
      if (isPostBodyContent(el)) {
        wrap.classList.add('reddit-zh-translator-wrap--post-body');
      }
  
      const btn = document.createElement('button');
      btn.className = 'reddit-zh-translator-btn';
      btn.type = 'button';
      btn.textContent = BTN_TEXT_TRANSLATE;
  
      const translate = () => toggleTranslation(target, btn);
      buttonTargetMap.set(btn, target);

      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        translate();
      });
  
      wrap.appendChild(btn);
  
      const mountControl = () => {
        if (target.isConnected) {
          target.after(wrap);
        } else {
          el.after(wrap);
        }
      };

      mountControl();
    }
  
    function scan(root = document) {
      updateTranslateAllButtonVisibility();

      if (root !== document && root.matches?.(CONTENT_SELECTORS)) {
        attachButton(root);
      }

      root.querySelectorAll?.(CONTENT_SELECTORS).forEach(attachButton);
      scheduleAutoTranslateAll();
    }
  
    let scanTimer = null;
    const scanQueue = new Set();
  
    function scheduleScan(root) {
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      scanQueue.add(root);
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scanQueue.forEach(scan);
        scanQueue.clear();
      }, 300);
    }
  
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach(scheduleScan);
      });
    });
  
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  
    scan();
  })();