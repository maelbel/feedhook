import { htmlToText, safeHttpUrl, truncate } from './text.js';

describe('htmlToText', () => {
  it('removes tags and decodes entities', () => {
    expect(htmlToText('<p>Fast &amp; <strong>safe</strong> &lt;3</p>')).toBe(
      'Fast & safe <3',
    );
  });

  it('separates blocks with a blank line and lists items one per line', () => {
    expect(
      htmlToText(
        '<h2>v1.2</h2><ul><li>fix a</li><li>fix b</li></ul><p>Thanks</p>',
      ),
    ).toBe('v1.2\n\n• fix a\n• fix b\nThanks');
  });

  it('keeps nested lists compact', () => {
    expect(
      htmlToText(
        '<ul><li>core<ul><li>fix 1</li><li>fix 2</li></ul></li><li>express</li></ul>',
      ),
    ).toBe('• core\n• fix 1\n• fix 2\n• express');
  });

  it('turns <br> into a line break', () => {
    expect(htmlToText('line 1<br>line 2<br/>line 3')).toBe(
      'line 1\nline 2\nline 3',
    );
  });

  it('drops scripts and styles with their content', () => {
    expect(htmlToText('a<script>alert("x")</script>b<style>p{}</style>c')).toBe(
      'abc',
    );
  });

  it('treats source whitespace and line breaks as single spaces, like HTML', () => {
    expect(htmlToText('  a \u00a0\t b\n\n\n\nc  ')).toBe('a b c');
  });

  it('never leaves more than one blank line', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><br><br><p>b</p>')).toBe('a\n\nb');
  });

  it('decodes an escaped tag as text instead of keeping markup', () => {
    expect(htmlToText('&lt;img src=x onerror=alert(1)&gt;')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});

describe('truncate', () => {
  it('keeps short text', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('cuts on a word boundary and adds an ellipsis', () => {
    expect(truncate('the quick brown fox jumps', 18)).toBe('the quick brown…');
  });

  it('never exceeds the limit', () => {
    expect(truncate('x'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('safeHttpUrl', () => {
  it.each([
    ['https://a.com/x', undefined, 'https://a.com/x'],
    ['http://a.com/x', undefined, 'http://a.com/x'],
    ['/post/1', 'https://a.com/feed.xml', 'https://a.com/post/1'],
    ['  https://a.com/x  ', undefined, 'https://a.com/x'],
  ])('accepts %s', (value, base, expected) => {
    expect(safeHttpUrl(value, base)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'not a url',
    '',
    null,
  ])('refuses %s', (value) => {
    expect(safeHttpUrl(value)).toBeUndefined();
  });
});
