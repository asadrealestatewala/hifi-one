// Copies the mirror into the repo: assets to public/site, page HTML to src/app/site/_html, with small patches
// for behaviour that depended on PHP. Usage: node scripts/site/install.mjs <mirrorDir> <repoDir>
import fs from "node:fs";
import path from "node:path";

const [MIRROR, REPO] = process.argv.slice(2).map((p) => path.resolve(p));
const HTML_DIR = path.join(REPO, "src", "app", "site", "_html");
fs.rmSync(path.join(REPO, "public", "site"), { recursive: true, force: true });
fs.cpSync(path.join(MIRROR, "public", "site"), path.join(REPO, "public", "site"), { recursive: true });
fs.rmSync(HTML_DIR, { recursive: true, force: true });
fs.mkdirSync(HTML_DIR, { recursive: true });

function replaceOnce(html, from, to, label) {
  const i = html.indexOf(from);
  if (i < 0 || html.indexOf(from, i + 1) >= 0) throw new Error(`patch "${label}" did not match exactly once`);
  return html.replace(from, to);
}
function replaceBetween(html, start, end, to, label) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`patch "${label}" did not match`);
  return html.slice(0, a) + to + html.slice(b);
}

const PATCHES = {
  contact(html) {
    return replaceOnce(
      html,
      '<form method="POST" action="">',
      '<!-- TODO: the PHP site handled this form server-side. Wire it to the ERP lead capture (/api/leads/capture) before relying on it; until then submitting does nothing. -->\n                    <form method="POST" action="" onsubmit="return false;">',
      "contact form",
    );
  },
  jobs(html) {
    // The PHP page re-queried job.php?ajax=1 on every filter change. The snapshot already holds every job,
    // so the same controls now filter the listed cards in the browser.
    const filter = `function applyFilters() {
            const search = searchInput.value.trim().toLowerCase();
            const want = { location: filterLocation.value, department: filterDepartment.value, type: filterType.value, workplace: filterWorkplace.value };
            let shown = 0;
            jobListings.querySelectorAll('.job-item').forEach(function (item) {
                const meta = item.querySelectorAll('.job-meta span');
                const text = function (el) { return el ? el.textContent.trim() : ''; };
                const workplace = text(item.querySelector('.tag.workplace'));
                const ok = (!search || item.textContent.toLowerCase().indexOf(search) >= 0)
                    && (!want.department || text(meta[0]) === want.department)
                    && (!want.location || text(meta[1]) === want.location)
                    && (!want.type || text(meta[2]) === want.type)
                    && (!want.workplace || workplace === want.workplace);
                item.style.display = ok ? '' : 'none';
                if (ok) shown++;
            });
            resultsCount.textContent = shown + (shown === 1 ? ' job found' : ' jobs found');
        }

        `;
    html = replaceBetween(html, "function applyFilters() {", "// ===== LIVE SEARCH ON KEYUP", filter, "job filters");
    // Every job is already on the page, so "Show More" has nothing further to load
    html = replaceBetween(
      html,
      "function showMoreJobs() {",
      "// THEME TOGGLE",
      `function showMoreJobs() {
            const wrap = document.querySelector('.show-more-wrap');
            if (wrap) wrap.style.display = 'none';
        }

        // ============================================================
        `,
      "show more",
    );
    return html;
  },
};

let n = 0;
for (const f of fs.readdirSync(path.join(MIRROR, "html"))) {
  const name = f.replace(/\.html$/, "");
  let html = fs.readFileSync(path.join(MIRROR, "html", f), "utf8");
  if (PATCHES[name]) html = PATCHES[name](html);
  if (/hifimarketing\.co\/(?!login\.php\?|register\.php)/.test(html)) console.log(`note: ${f} still names hifimarketing.co`);
  fs.writeFileSync(path.join(HTML_DIR, f), html);
  n++;
}
console.log(`installed ${n} pages`);
