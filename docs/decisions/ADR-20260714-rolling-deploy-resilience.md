# ADR-20260714: Bounded, observable rolling deploy control

Status: accepted

## Decision

Keep the Pi5 load threshold at 75% of online CPUs and replace immediate
post-build rejection with bounded stable-load sampling. Candidate images are
identified by immutable source/config labels and reused only after matching
both labels and repeating validation. Pause only the measured signage renderer
while a candidate is built and validated. The first deployment of that control
may be serving an API older than the control route; record that state and use
the bounded load gate for the one cached bootstrap build rather than attempting
an unsafe external process stop.

Rolling release ownership is represented by a boot-aware process-group lease.
Cancellation and terminal timeout retain maintenance for an uncertain terminal;
they never silently clear it. Prisma history is checksum-verified for every
completed migration on every candidate.

## Consequences

The release can wait up to ten minutes for Pi5 load to settle without spending
that time on repeat image builds. An unavailable kiosk stops the rollout in a
durable failed state. The additional internal signage control requires a
protected deploy-control token and is unavailable through the public UI. Once
the current API contains the route, a missing route is no longer a compatible
condition and fails the candidate build.

Pi4 builds become conditional on their actual image inputs. A configuration-only
change recreates the service without rebuilding it, which keeps image freshness
correct while avoiding unrelated Python and OS package work.
