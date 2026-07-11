/**
 * IndexNow key file — emitted at /<key>.txt when business.seo.indexnow_key is
 * set. IndexNow keys are public by design (search engines fetch this file to
 * prove you control the host), so the key lives in business.json, not in a
 * secret store. One fleet-wide key value is fine: the spec only requires the
 * file to exist on each host. Pings are sent by the engine's
 * bin/indexnow-ping.mjs (also run from bin/launch-platform.mjs).
 */
module.exports = class {
  data() {
    return {
      eleventyExcludeFromCollections: true,
      eleventyComputed: {
        permalink: (data) =>
          data.business?.seo?.indexnow_key ? `/${data.business.seo.indexnow_key}.txt` : false,
      },
    };
  }
  render(data) {
    return data.business?.seo?.indexnow_key || "";
  }
};
