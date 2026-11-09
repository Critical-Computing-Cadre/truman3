# 23. Staging runs on AWS, written in CDK

**Status:** Deployed. Staging has run from this since November 2026. The first deployment needed fixes, which are in the commits after it. [Cloud architecture](../cloud.md) describes it as it runs now.

## Decision

`infra/` describes one deployment in AWS CDK, in TypeScript like everything else. Staging is the only stage, in its own account, and has no real participants.

- **CloudFront is the one way in.** It holds the apps, `/api`, and media at one address, so cookies and links work as ADR 19 and ADR 21 expect.
- **The load balancer has no public address.** CloudFront reaches it with a VPC origin, a private connection. This means no certificate is needed between them, and nothing has to check that a request came through CloudFront.
- **There's no NAT gateway.** The API sits in a public subnet, with a public address so it can reach AWS and Prolific, and a firewall that lets in only the load balancer. A NAT gateway would cost more than the API does.
- **The apps' pages are chosen by a small CloudFront Function,** not by CloudFront's custom error pages. Those apply to the whole distribution, so they'd replace the API's real 403s and 404s with a web page.
- **Edge logs list what's in them, and leave out the path, query, address, referrer, and cookies.** Study links carry recruitment IDs, and a path can hold a username. Logs can't be cleaned when someone withdraws. The cost is that a log says which part of the site failed, but not which page.
- **The API's image also holds `apps/cli`,** because the database has no route from outside, so creating the first researcher has to run inside. Those tasks log to a group kept for one day, since the first password is printed there.
- **What happens to data comes from one setting,** `holdsRealData`. With it on, the database, media, and secrets are kept if removed, with deletion protection and versioned media. A stage can't get the one without the other.
- **The account and zones are written down,** so building needs no call to AWS and can't deploy to the wrong account.
- **Storage uses the container's role.** With no keys set, the AWS SDK finds credentials itself. Local storage still sets keys.

## Alternatives

- **A public load balancer that only lets in CloudFront's addresses.** CloudFront would then need HTTPS to reach it, which needs a domain, or cookies would cross the internet unencrypted. Those addresses are also shared by every CloudFront customer, so it needs a secret header as well.
- **The API in a private subnet.** This is the usual advice, but it needs a NAT gateway, or paid endpoints for each AWS service, and still couldn't reach Prolific without NAT.
- **One small server, or Terraform.** See the vault note "Cloud architecture options." CDK keeps the infrastructure in the language students already use.
- **Running migrations automatically while deploying.** It's what we'd want eventually, but it takes a custom resource or a pipeline. By hand, the steps are visible while we learn what a deployment does. CI that deploys should take this over.
- **A database URL secret.** The password would be stored twice, with one copy going stale if it were ever rotated. Instead the address is put together in the container.

## Consequences

- A first deployment takes three steps, and an update with a migration stops the API briefly.
- The API has a public address, so its firewall is all that protects it from direct connections. A test checks that rule.
- The load balancer's firewall allows CloudFront's addresses, not only this distribution. Because the balancer is in a private subnet, that only applies to traffic from the VPC origin.
- CloudFront can't reach one zone in us-east-1 (`use1-az3`), and zone names differ by account, so they need checking before the first deployment.
- Connections to the database are encrypted, but don't verify the server's certificate (`sslmode=require`). Verifying needs the RDS certificate bundle in the image.
