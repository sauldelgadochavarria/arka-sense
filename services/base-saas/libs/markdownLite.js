'use strict';

/**
 * Markdown mínimo seguro (sin dependencias): escape HTML + subset útil para ayuda.
 * Soporta: # ## ###, **negrita**, `código`, listas -, párrafos, saltos de línea.
 */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  return s;
}

function markdownToHtml(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inList = false;
  let inCode = false;
  let codeBuf = [];

  function closeList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  for (const raw of lines) {
    const line = raw;

    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre class="kb-pre"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineFormat(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }

    closeList();

    if (/^###\s+/.test(line)) {
      out.push(`<h3>${inlineFormat(line.replace(/^###\s+/, ''))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      out.push(`<h2>${inlineFormat(line.replace(/^##\s+/, ''))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      out.push(`<h1>${inlineFormat(line.replace(/^#\s+/, ''))}</h1>`);
    } else if (!line.trim()) {
      out.push('');
    } else {
      out.push(`<p>${inlineFormat(line)}</p>`);
    }
  }

  closeList();
  if (inCode) {
    out.push(`<pre class="kb-pre"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }

  return out.join('\n');
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

module.exports = {
  escapeHtml,
  markdownToHtml,
  slugify
};
