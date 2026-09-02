/* マレーシア研修旅行 準備 — オフライン用 Service Worker
 *
 * 方針：通信は最小限。手元にあるものは必ず手元から返し、
 *       裏で勝手に取り直すことはしない（通信量を使わないため）。
 *
 * 【ファイルを更新したときにやること】
 *   下の CACHE の数字を必ず上げる（prep-v5 → prep-v4 のように）。
 *   これを上げないと、古いキャッシュが残り続けて更新が届きません。
 */

var CACHE = "prep-v7";

var ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

/* 新しい版を裏で用意する。すぐには切り替えない（作業中に画面が入れ替わらないように）。 */
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
  );
});

/* 切り替わったら古いキャッシュを捨てる。 */
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* アプリ側の「更新する」ボタンから呼ばれる。ここで初めて新しい版に切り替わる。 */
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* キャッシュのみ。ヒットしたらそこで終わりで、通信はしない。
   キャッシュに無いものだけネットに取りに行く（オフラインなら失敗する）。 */
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;

  /* 外部API（為替・天気）は横取りしない。素通ししてネットに行かせる。 */
  var u;
  try { u = new URL(e.request.url); } catch (err) { return; }
  if (u.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).catch(function () {
        return caches.match("./index.html");
      });
    })
  );
});
