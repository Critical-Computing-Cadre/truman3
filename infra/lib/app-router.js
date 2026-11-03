// Runs at CloudFront on each request for the apps, as a CloudFront Function. Both apps are
// single-page apps, so any path that isn't a built file has to load that app's index.html.
// CloudFront's own "custom error pages" can't do this: they apply to the whole distribution, so
// they'd turn the API's real 403s and 404s into a web page.
// biome-ignore lint/correctness/noUnusedVariables: CloudFront calls this.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === "/admin") {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: "/admin/" } },
    };
  }
  if (uri.startsWith("/admin/")) {
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
