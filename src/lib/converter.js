/**
 * HTML to Markdown Converter
 * 轻量级 HTML→Markdown 转换器，针对微信公众号文章优化
 * 
 * 支持：标题、段落、加粗、斜体、链接、图片、无序/有序列表、
 *       引用块、分隔线、换行、行内代码
 */

const Converter = {
  /**
   * 将 HTML 字符串转换为 Markdown
   * @param {string} html - HTML 字符串
   * @returns {string} - Markdown 文本
   */
  convert(html) {
    // 创建临时 DOM 解析
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<div id="_wx_root_">' + html + '</div>', 
      'text/html'
    );
    const root = doc.getElementById('_wx_root_');
    
    if (!root) return '';
    
    let markdown = '';
    this._processChildren(root, markdown = []);
    
    let result = markdown.join('\n\n');
    // 清理多余空行
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
  },

  /**
   * 递归处理子节点
   */
  _processChildren(parent, lines) {
    for (const node of parent.childNodes) {
      const line = this._processNode(node);
      if (line !== null && line !== '') {
        lines.push(line);
      }
    }
  },

  /**
   * 处理单个节点
   */
  _processNode(node) {
    switch (node.nodeType) {
      case Node.TEXT_NODE:
        return this._escapeMarkdown(node.textContent.trim());
      
      case Node.ELEMENT_NODE:
        return this._processElement(node);
      
      default:
        return '';
    }
  },

  /**
   * 处理元素节点
   */
  _processElement(el) {
    const tag = el.tagName.toLowerCase();
    const text = this._getInnerText(el);
    const html = this._getInnerHTML(el);

    switch (tag) {
      // 标题
      case 'h1': return this._heading(text, 1);
      case 'h2': return this._heading(text, 2);
      case 'h3': return this._heading(text, 3);
      case 'h4': return this._heading(text, 4);
      case 'h5': return this._heading(text, 5);
      case 'h6': return this._heading(text, 6);
      
      // 段落 / div → 根据上下文判断
      case 'p':
      case 'div':
      case 'section':
        return this._processInlineContent(el);
      
      // 加粗
      case 'strong':
      case 'b':
        return '**' + this._processInlineContent(el) + '**';
      
      // 斜体
      case 'em':
      case 'i':
        return '*' + this._processInlineContent(el) + '*';
      
      // 链接
      case 'a':
        const href = el.getAttribute('href') || '';
        return '[' + this._processInlineContent(el) + '](' + href + ')';
      
      // 图片
      case 'img':
        const src = el.getAttribute('src') || el.getAttribute('data-original-src') || '';
        const alt = el.getAttribute('alt') || '图片';
        return '![' + alt + '](' + src + ')';
      
      // 无序列表项
      case 'li': {
        const parentTag = el.parentElement ? el.parentElement.tagName.toLowerCase() : '';
        const prefix = (parentTag === 'ol') ? '1. ' : '- ';
        return prefix + this._processInlineContent(el);
      }
      
      // 引用
      case 'blockquote':
        return '> ' + this._processInlineContent(el).replace(/\n/g, '\n> ');
      
      // 分隔线
      case 'hr':
        return '---';
      
      // 换行
      case 'br':
        return '\n\n';
      
      // 行内代码
      case 'code':
        if (el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
          return '```\n' + el.textContent.trim() + '\n```';
        }
        return '`' + el.textContent.trim() + '`';
      
      // 预格式化
      case 'pre':
        return '```\n' + el.textContent.trim() + '\n```';
      
      // span（忽略样式，只提取文字）
      case 'span':
      case 'label':
      case 'small':
        return this._processInlineContent(el);
      
      // 列表容器（不直接输出，由 li 处理）
      case 'ul':
      case 'ol':
        const items = [];
        this._processChildren(el, items);
        return items.join('\n');
      
      // 表格
      case 'table':
        return this._processTable(el);
      
      // 默认：递归子节点
      default:
        return this._processInlineContent(el);
    }
  },

  /**
   * 处理标题
   */
  _heading(text, level) {
    const prefix = '#'.repeat(level);
    return prefix + ' ' + this._stripHtml(text);
  },

  /**
   * 处理行内内容（保留格式但不产生换行）
   */
  _processInlineContent(el) {
    if (!el || el.nodeType === Node.TEXT_NODE) {
      return el ? this._escapeMarkdown(el.textContent.trim()) : '';
    }
    
    const parts = [];
    for (const child of el.childNodes) {
      const part = this._processNode(child);
      if (part) parts.push(part);
    }
    return parts.join('');
  },

  /**
   * 处理表格
   */
  _processTable(table) {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return '';
    
    const result = [];
    
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td, th');
      const cellTexts = Array.from(cells).map(c => 
        this._stripHtml(this._processInlineContent(c)).trim()
      );
      result.push('| ' + cellTexts.join(' | ') + ' |');
      
      // 表头分隔线
      if (i === 0) {
        result.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
      }
    }
    
    return result.join('\n');
  },

  /**
   * 获取元素内部文本（递归）
   */
  _getInnerText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    // 将 br 转为换行符
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    return clone.textContent || '';
  },

  /**
   * 获取元素内部 HTML
   */
  _getInnerHTML(el) {
    if (!el) return '';
    return el.innerHTML || '';
  },

  /**
   * 去除 HTML 标签
   */
  _stripHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').trim();
  },

  /**
   * 转义 Markdown 特殊字符
   */
  _escapeMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/`/g, '\\`')
      .replace(/#/g, '\\#')
      .replace(/~/g, '\\~');
  }
};

export { Converter };
