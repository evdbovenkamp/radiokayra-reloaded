import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";
import Secret from "gi://Secret";
import * as Constants from "./constants.js";

//PodcastIndex.org API client. Safe to import from both the prefs process and
//the panel process: every call here is async (Soup + libsecret async APIs),
//never sync/blocking, so it can't freeze the gnome-shell main loop.

const credentialSchema = new Secret.Schema(
    Constants.PODCASTINDEX_SECRET_SCHEMA_ID,
    Secret.SchemaFlags.NONE,
    { "type": Secret.SchemaAttributeType.STRING }
);

export function getCredentials(callback) {
    Secret.password_lookup(credentialSchema, { type: Constants.PODCASTINDEX_SECRET_ATTR_KEY }, null, (source, result) => {
        let apiKey = null, apiSecret = null;
        try { apiKey = Secret.password_lookup_finish(result); } catch (e) { /* not configured yet */ }

        Secret.password_lookup(credentialSchema, { type: Constants.PODCASTINDEX_SECRET_ATTR_SECRET }, null, (source2, result2) => {
            try { apiSecret = Secret.password_lookup_finish(result2); } catch (e) { /* not configured yet */ }
            callback(apiKey, apiSecret);
        });
    });
}

export function storeCredentials(apiKey, apiSecret, callback) {
    Secret.password_store(
        credentialSchema, { type: Constants.PODCASTINDEX_SECRET_ATTR_KEY }, Secret.COLLECTION_DEFAULT,
        "PodcastIndex.org API key", apiKey, null,
        (source, result) => {
            try { Secret.password_store_finish(result); } catch (e) { callback(false); return; }
            Secret.password_store(
                credentialSchema, { type: Constants.PODCASTINDEX_SECRET_ATTR_SECRET }, Secret.COLLECTION_DEFAULT,
                "PodcastIndex.org API secret", apiSecret, null,
                (source2, result2) => {
                    try { Secret.password_store_finish(result2); callback(true); }
                    catch (e) { callback(false); }
                }
            );
        }
    );
}

function buildAuthHeaders(apiKey, apiSecret) {
    const now = Math.floor(GLib.get_real_time() / 1000000).toString();
    const checksum = new GLib.Checksum(GLib.ChecksumType.SHA1);
    checksum.update(new TextEncoder().encode(apiKey + apiSecret + now));
    return {
        "X-Auth-Date": now,
        "X-Auth-Key": apiKey,
        "Authorization": checksum.get_string(),
        "User-Agent": Constants.PODCASTINDEX_USER_AGENT,
    };
}

//basePath is e.g. "/search/byterm", params a plain {key: value} object.
//callback(jsonOrNull, errorMessageOrNull).
function request(basePath, params, callback) {
    getCredentials((apiKey, apiSecret) => {
        if (!apiKey || !apiSecret) {
            callback(null, "PodcastIndex.org is not configured yet (missing API key/secret).");
            return;
        }
        try {
            const session = new Soup.Session({ timeout: 10 });
            const message = Soup.Message.new_from_encoded_form(
                "GET",
                `${Constants.PODCASTINDEX_API_BASE}${basePath}`,
                Soup.form_encode_hash(params)
            );
            const headers = buildAuthHeaders(apiKey, apiSecret);
            for (const [k, v] of Object.entries(headers)) message.get_request_headers().append(k, v);
            session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
                if (message.get_status() !== Soup.Status.OK) {
                    callback(null, `PodcastIndex.org request failed (HTTP ${message.get_status()})`);
                    return;
                }
                try {
                    const bytes = sess.send_and_read_finish(result);
                    const text = new TextDecoder("utf-8").decode(bytes.get_data());
                    callback(JSON.parse(text), null);
                } catch (e) { callback(null, `${e}`); }
            });
        } catch (e) { callback(null, `${e}`); }
    });
}

export function searchPodcasts(term, callback) {
    request("/search/byterm", { q: term, max: `${Constants.MAX_PODCAST_SEARCH_RESULTS}`, clean: "true" }, (json, error) => {
        if (error) { callback([], error); return; }
        callback(json?.feeds ?? [], null);
    });
}

export function getEpisodes(feedId, callback) {
    request("/episodes/byfeedid", { id: `${feedId}`, max: `${Constants.MAX_PODCAST_EPISODE_RESULTS}` }, (json, error) => {
        if (error) { callback([], error); return; }
        callback(json?.items ?? [], null);
    });
}

export function getLatestEpisode(feedId, callback) {
    request("/episodes/byfeedid", { id: `${feedId}`, max: "1" }, (json, error) => {
        if (error) { callback(null, error); return; }
        const items = json?.items ?? [];
        callback(items.length > 0 ? items[0] : null, items.length > 0 ? null : "No episodes found.");
    });
}
