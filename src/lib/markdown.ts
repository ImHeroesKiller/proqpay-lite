/** Minimal safe markdown → HTML for IDA bubbles */

export function renderMarkdown(src: string): string {
  if (!src) return '';

  let s = src
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');

  // fenced code blocks
  s = s.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) => {
    return `<pre style="margin:8px 0;padding:10px 12px;background:var(--bg-sunk);border-radius:8px;overflow:auto;font-size:12px;line-height:1.45"><code>${code.trim()}</code></pre>`;
  });

  // inline code
  s = s.replace(/`([^`]+)`/g, '<code style="background:var(--bg-sunk);padding:1px 5px;border-radius:4px;font-size:12px">$1</code>');

  // bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // italic *text* (avoid bold leftovers)
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

  // unordered lists
  s = s.replace(/(?:^|\n)([-*] .+(\n[-*] .+)*)/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean)
      .map((item) => `<li style="margin:2px 0">${item}</li>`)
      .join('');
    return `<ul style="margin:6px 0 6px 18px;padding:0">${items}</ul>`;
  });

  // ordered lists
  s = s.replace(/(?:^|\n)((?:\d+\. .+\n?)+)/g, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => line.replace(/^\d+\.\s+/, '').trim())
      .filter(Boolean)
      .map((item) => `<li style="margin:2px 0">${item}</li>`)
      .join('');
    return `<ol style="margin:6px 0 6px 18px;padding:0">${items}</ol>`;
  });

  // line breaks
  s = s.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>');

  return s;
}
