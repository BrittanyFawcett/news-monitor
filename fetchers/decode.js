function decodeEntities(str) {
  if (!str) return str;
  let s = String(str);

  // Smart single quotes → plain apostrophe
  s = s.replace(/’|&#8217;|&#x2019;|&rsquo;/g, "'");
  s = s.replace(/‘|&#8216;|&#x2018;|&lsquo;/g, "'");

  // Smart double quotes → plain double quote
  s = s.replace(/“|&#8220;|&#x201C;|&ldquo;/g, '"');
  s = s.replace(/”|&#8221;|&#x201D;|&rdquo;/g, '"');

  // En dash → hyphen, em dash stays as em dash character
  s = s.replace(/–|&#8211;|&#x2013;|&ndash;/g, '-');
  s = s.replace(/—|&#8212;|&#x2014;|&mdash;/g, '—');

  // Ellipsis → three dots
  s = s.replace(/…|&#8230;|&#x2026;|&hellip;/g, '...');

  // Non-breaking space → regular space
  s = s.replace(/ |&#160;|&#xA0;|&nbsp;/g, ' ');

  // Less-than, greater-than
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');

  // Apostrophe (XML/HTML)
  s = s.replace(/&#39;|&apos;/g, "'");

  // Remaining numeric decimal entities
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

  // Remaining numeric hex entities
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // Ampersand last — avoids accidentally creating new entity sequences above
  s = s.replace(/&amp;/g, '&');

  // Collapse multiple spaces and trim
  return s.replace(/  +/g, ' ').trim();
}

module.exports = { decodeEntities };
