// Wraps each word of a heading's HTML in a mask, so the words can rise into place with CSS alone:
// the heading is real text from the first paint, with no wait for a script to split it.
export function maskWords(html: string) {
  let i = 0;
  return html.split(/(<[^>]+>)/).map((part) => part.startsWith('<') ? part
    : part.split(/(\s+)/).map((w) => (!w || /^\s+$/.test(w) ? w : `<span class="wm"><span style="--i:${i++}">${w}</span></span>`)).join('')).join('');
}

const NUMBERS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** 3 as 'Three', for a heading; past ten, the figure. */
export const numberWord = (n: number) => NUMBERS[n] ?? String(n);
