'use strict';
const http = require('http');
const { server } = require('./src/ui/server.js');
const PORT = 14788;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log('Server up on', PORT);

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
    cond ? pass++ : fail++;
  };

  const home = await get('/');
  check('homepage 200', home.status === 200);
  check('homepage references i18n.js', home.body.includes('i18n.js'));
  check('homepage has lang toggle button', home.body.includes('id="langBtn"'));
  check('homepage has data-i18n attrs', home.body.includes('data-i18n="welcome.title"'));
  check('homepage has data-i18n-task', home.body.includes('data-i18n-task'));

  const i18n = await get('/i18n.js');
  check('i18n.js served 200', i18n.status === 200);
  check('i18n.js has Chinese', i18n.body.includes('欢迎使用你的 AI 编程助手'));
  check('i18n.js has toggleLang', i18n.body.includes('function toggleLang'));
  check('i18n.js has zh translations', i18n.body.includes("'status.running'"));

  const js = await get('/app.js');
  check('app.js served 200', js.status === 200);
  check('app.js uses window.i18n', js.body.includes('window.i18n'));

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(() => process.exit(fail === 0 ? 0 : 1));
})().catch(e => { console.error(e); process.exit(1); });
