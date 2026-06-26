/**
 * 微信文章抓取器 - Content Script v2.1
 * 
 * 在页面上下文运行（有完整 DOM 访问），
 * 提取文章内容并直接转换为 Markdown（避免 Service Worker 的 DOMParser 限制）。
 */

(function() {
  'use strict';

  if (window.__wxCaptureInjected) return;
  window.__wxCaptureInjected = true;

  /**
   * 提取文章内容（元数据 + Markdown + 图片列表）
   */
  function extractArticle() {
    const result = {
      success: false,
      title: '', author: '', publishTime: '',
      sourceUrl: window.location.href,
      markdown: '',
      images: []
    };

    try {
      // --- 元数据 ---
      const tEl = document.querySelector('#activity-name') ||
                   document.querySelector('.rich_media_title') ||
                   document.querySelector('h1.rich_media_title');
      result.title = (tEl ? tEl.textContent.trim() : document.title).replace(/\s+/g, ' ');

      const aEl = document.querySelector('#js_name') ||
                  document.querySelector('#js_author_name') ||
                  document.querySelector('.rich_media_meta_text');
      if (aEl) result.author = aEl.textContent.trim();

      const tmEl = document.querySelector('#publish_time') ||
                   document.querySelector('.rich_media_meta_text + .rich_media_meta_text');
      if (tmEl) result.publishTime = tmEl.textContent.trim();

      // --- 正文 ---
      const contentEl = document.querySelector('#js_content') ||
                        document.querySelector('.rich_media_content') ||
                        document.querySelector('.rich_media_area_primary');
      if (!contentEl) { result.error = '未找到文章正文区域'; return result; }

      const clone = contentEl.cloneNode(true);

      // 清理不需要的元素
      clone.querySelectorAll(
        'script,style,.reward_area,.rich_media_tool,.qr_code_pc_outer,' +
        '.rich_media_area_extra,#js_pc_qr_code,.code-snippet__js,' +
        'iframe,button,.copyright_logo'
      ).forEach(el => el.remove());

      // --- 收集图片（替换为本地路径）---
      const imageMap = [];
      clone.querySelectorAll('img').forEach((img) => {
        const src = getImageSource(img);
        if (!src) return;
        const ext = getImageExt(src);
        const fn = `img_${String(imageMap.length + 1).padStart(3, '0')}.${ext}`;
        img.setAttribute('src', `images/${fn}`);
        img.removeAttribute('data-src');
        imageMap.push({ index: imageMap.length, originalUrl: src, localName: fn });
      });
      result.images = imageMap;

      // --- 转换为 Markdown（在页面上下文中，直接遍历 DOM）---
      const bodyMd = domToMarkdown(clone);
      result.markdown = bodyMd;
      result.success = true;
    } catch (err) {
      result.error = '提取失败: ' + err.message;
    }
    return result;
  }

  // ============================================================
  // DOM → Markdown（直接用 DOM Node，不需要 DOMParser）
  // ============================================================

  function domToMarkdown(root) {
    const lines = [];
    walk(root, lines);
    return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function walk(node, lines) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const line = processNode(child);
      if (line !== null && line !== '') lines.push(line);
    }
  }

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/\s+/g, ' ').trim();
      return t || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    const inner = () => getInlineContent(node);

    switch (tag) {
      case 'h1': return '# ' + inner();
      case 'h2': return '## ' + inner();
      case 'h3': return '### ' + inner();
      case 'h4': return '#### ' + inner();
      case 'h5': return '##### ' + inner();
      case 'h6': return '###### ' + inner();
      case 'p':
      case 'div':
      case 'section':
        // 如果内部只有文本 → 作为段落；如果有子 block → 递归
        if (hasBlockChild(node)) {
          const sub = []; walk(node, sub); return sub.join('\n\n');
        }
        return inner();
      case 'strong': case 'b': return '**' + inner() + '**';
      case 'em': case 'i': return '*' + inner() + '*';
      case 'br': return '';
      case 'hr': return '---';
      case 'blockquote': {
        const q = inner();
        return '> ' + q.replace(/\n/g, '\n> ');
      }
      case 'a': {
        const href = node.getAttribute('href') || '';
        return '[' + inner() + '](' + href + ')';
      }
      case 'img': {
        const src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '图片';
        if (!src) return '';
        return '![' + alt + '](' + src + ')';
      }
      case 'code':
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
          return '```\n' + node.textContent.trim() + '\n```';
        }
        return '`' + node.textContent.trim() + '`';
      case 'pre': return '```\n' + node.textContent.trim() + '\n```';
      case 'li': {
        const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
        const prefix = parentTag === 'ol' ? '1. ' : '- ';
        return prefix + inner();
      }
      case 'ul': case 'ol': {
        const items = []; walk(node, items); return items.join('\n');
      }
      case 'table': return tableToMd(node);
      case 'span': case 'label': case 'small': return inner();
      default: return inner();
    }
  }

  function getInlineContent(el) {
    const parts = [];
    for (let c = el.firstChild; c; c = c.nextSibling) {
      const p = processNode(c);
      if (p) parts.push(p);
    }
    return parts.join('');
  }

  function hasBlockChild(el) {
    const blockTags = ['p','div','section','ul','ol','table','h1','h2','h3','h4','h5','h6','blockquote','pre','hr'];
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.ELEMENT_NODE && blockTags.includes(c.tagName.toLowerCase())) return true;
    }
    return false;
  }

  function tableToMd(table) {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return '';
    const md = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td,th');
      const texts = Array.from(cells).map(c => c.textContent.trim());
      md.push('| ' + texts.join(' | ') + ' |');
      if (i === 0) md.push('| ' + texts.map(() => '---').join(' | ') + ' |');
    }
    return md.join('\n');
  }

  function getImageExt(url) {
    const m = { jpeg: 'jpeg', jpg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp' };
    const match = url.match(/wx_fmt=(\w+)/i) || url.match(/\.(\w+)(?:\?|$)/);
    return (match && m[match[1].toLowerCase()]) ? m[match[1].toLowerCase()] : 'jpeg';
  }

  function getImageSource(img) {
    const attrs = ['data-src', 'data-original-src', 'data-backsrc', 'src'];
    for (const attr of attrs) {
      const raw = (img.getAttribute(attr) || '').trim();
      if (!raw || raw.startsWith('data:') || raw.includes('pic_blank.gif')) continue;
      if (/^https?:\/\//i.test(raw)) return raw.replace(/&amp;/g, '&');
    }
    return '';
  }

  // ============================================================
  // 消息监听
  // ============================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractArticle') {
      sendResponse(extractArticle());
    }
    return true;
  });

})();
