// dist/ のビルド結果を1ファイルの HTML（dist/contest-prep.html）にまとめる。
// Claude のアーティファクトなど、1ファイルでしか置けない場所に公開するときに使う。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const assets = join('dist', 'assets');
const files = readdirSync(assets);
const read = (ext) => files.filter((f) => f.endsWith(ext)).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const css = read('.css');
const js = read('.js').replaceAll('</script', '<\\/script');

const html = `<title>Contest Prep</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#16181d">
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync(join('dist', 'oshi-diet.html'), html);
console.log(`dist/contest-prep.html (${Math.round(html.length / 1024)} KB)`);
