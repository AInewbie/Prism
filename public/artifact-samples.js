// Deliberately authored local fixtures, never represented as live model output.
export function sampleFiles(provider, outputMode = 'text') {
  if (outputMode === 'visual' && ['openai', 'gemini'].includes(provider)) return [{
    name: provider + '-visual-sample.png', mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl2cAAAAASUVORK5CYII=',
  }];
  const samples = {
    openai: [{ name: 'tiny-counter.html', mimeType: 'text/html', text: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tiny counter · Sample app</title><style>body{font:18px system-ui;background:#f0f5e9;color:#183a2b;padding:32px;text-align:center}button{font:inherit;background:#24563f;color:white;border:0;border-radius:12px;padding:14px 24px}output{display:block;font-size:64px;margin:22px}</style><h1>A tiny working app</h1><p>Handwritten demo fixture · no AI call</p><output id="count">0</output><button onclick="document.getElementById(\'count\').textContent=++window.counter">Add one</button><script>window.counter=0;</script></html>' }],
    gemini: [{ name: 'comparison-map.svg', mimeType: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 280"><rect width="520" height="280" rx="20" fill="#eef4e8"/><text x="32" y="52" font-family="system-ui" font-size="21" fill="#183a2b">A wider perspective</text><g fill="#24563f"><rect x="32" y="88" width="96" height="100" rx="12"/><rect x="152" y="108" width="96" height="80" rx="12"/><rect x="272" y="70" width="96" height="118" rx="12"/><rect x="392" y="126" width="96" height="62" rx="12"/></g><text x="32" y="244" font-family="system-ui" font-size="15" fill="#586b58">Illustrative image fixture · not measured data</text></svg>' }],
    grok: [{ name: 'review-template.csv', mimeType: 'text/csv', text: 'answer,accuracy,usefulness,clarity\nA,,,\nB,,,\nC,,,\nD,,,\n' }],
    claude: [{ name: 'implementation-notes.md', mimeType: 'text/markdown', text: '# Sample implementation notes\n\n- Compare the same prompt.\n- Review every output, including files.\n- Keep the original files with the final draft.\n\nThis is an authored fixture, not a model response.\n' }],
  };
  return samples[provider] || [];
}
