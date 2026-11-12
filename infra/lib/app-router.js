// Runs at CloudFront on each request for the apps and the API, as a CloudFront Function.
//
// Both apps are single-page apps, so any path that isn't a built file has to load that app's
// index.html. CloudFront's own "custom error pages" can't do this: they apply to the whole
// distribution, so they'd turn the API's real 403s and 404s into a web page.
//
// On a participant domain, such as one a study runs at so its address doesn't say "research", the
// admin app and the admin API don't answer, so nothing there leads to Truman (ADR 74).

// The stack writes the stage's participant domains here when it's built.
var PARTICIPANT_HOSTS = [];

function notFound() {
  return { statusCode: 404, statusDescription: "Not Found" };
}

// biome-ignore lint/correctness/noUnusedVariables: CloudFront calls this.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var headers = request.headers || {};
  var host = headers.host ? headers.host.value : "";
  var forParticipants = PARTICIPANT_HOSTS.indexOf(host) !== -1;

  if (uri.startsWith("/api/")) {
    if (forParticipants && (uri === "/api/admin" || uri.startsWith("/api/admin/"))) {
      return notFound();
    }
    return request;
  }
  if (uri === "/admin" || uri.startsWith("/admin/")) {
    if (forParticipants) {
      return notFound();
    }
    if (uri === "/admin") {
      return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: { location: { value: "/admin/" } },
      };
    }
    if (!uri.startsWith("/admin/assets/")) {
      request.uri = "/admin/index.html";
    }
    return request;
  }
  if (!uri.startsWith("/assets/")) {
    request.uri = "/index.html";
  }
  return request;
}
