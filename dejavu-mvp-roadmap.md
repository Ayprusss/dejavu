# Dejavu — Depth-First MVP Roadmap

Six items, cut down from ten. The filter: **can you defend every decision in this item for fifteen minutes under questioning?** Anything whose justification is "it handles scale" was cut, because Dejavu has no traffic and claiming otherwise is the fastest way to lose credibility in an interview.

---

## What Got Cut, and Why

| Original item | Verdict | Reasoning |
|---|---|---|
| Image build/push + scanning | **Folded into #4** | Multi-stage builds, non-root users, ECR tagging, and Trivy are real practices, but they are configuration, not architecture. They generate maybe two minutes of conversation. They belong inside the deploy item, not beside it. |
| S3 + CloudFront | **Cut** | A CDN's entire justification is edge latency and origin offload for real users. With zero traffic there is no honest answer to "why did you need this?" other than "I wanted to learn CloudFront." Vercel already does this for free. |
| Event-driven webhooks (SQS/EventBridge) | **Half folded into #5 and #6** | Queue-based decoupling solves fulfillment throughput and retry durability — problems you do not have. But *idempotency* and *observability* are real regardless of scale, so those survive inside the testing and deployment items. Introducing a queue to a store with no orders is architectural cosplay. |
| Release automation + SBOM | **Cut** | `semantic-release`, changelogs, and SBOMs are coordination tools for multi-contributor projects with downstream consumers. On a solo repo they are ceremony. Nobody will ask about them, and if they do, the honest answer is unimpressive. |

**The pattern:** what got cut was everything justified by *scale*. What survived is justified by *correctness*, *reproducibility*, and *safety* — properties that matter at one user just as much as at a million, which is exactly why they hold up under questioning.

---

## Execution Order

| # | Item | Type | Effort | Cost | Depth ceiling |
|---|---|---|---|---|---|
| 1 | Test suite + CI gate | CI/CD | L | $0 | High — test strategy for money-handling code |
| 2 | Managed Postgres + versioned migrations | Cloud | M | Free tier | High — networking, schema evolution |
| 3 | Terraform + OIDC + Secrets Manager | Cloud | L | ~$0 | Very high — IaC, IAM, credential design |
| 4 | Containerized backend on Fargate + ALB | Cloud | L | ~$20/mo | High — orchestration, health, rollout |
| 5 | Integration + E2E against real dependencies | CI/CD | L | $0 | Very high — idempotency, webhook correctness |
| 6 | Staging → production CD with rollback | CI/CD | M | Marginal | Very high — migration ordering, failure modes |

Sequence is load-bearing: you cannot write a deployment pipeline before there is something to deploy, and you should not deploy anything by hand that Terraform will later need to own.

---

## 1. Test Suite + CI Gate

**Build**
- Vitest + Supertest against `authController`, `checkoutController`, `productController`, `adminController`.
- Frontend unit tests for cart state, price arithmetic, and auth-guarded routes.
- ESLint + Prettier enforced in CI, Node 20/22 matrix, dependency caching.
- Branch protection on `main` requiring green checks.

**The depth is in what you choose to test.** This is a payment system. The interesting tests are not "does the products endpoint return 200" — they are: does an admin-only route reject a valid JWT belonging to a non-admin? Does the cart total recompute server-side rather than trusting the client-submitted price? Does bcrypt comparison run in constant time on failed login? Does registration correctly link prior guest orders by email — and what happens if two accounts claim the same guest email?

**Be ready to answer**
- Why unit-test controllers with a mocked DB when you also run integration tests (#5)? What does each layer actually catch?
- Where did you decide *not* to test, and why?
- Your admin panel uses RBAC. How do you test authorization without testing authentication forty times over?
- What is your coverage number, and why is chasing a higher one a bad idea?

**Bullet:** *Built unit and controller-level test suites for a Stripe-integrated e-commerce API, prioritizing authorization boundaries and server-side price integrity; enforced via GitHub Actions with required status checks on `main`.*

> This is the item most likely to be skipped and most likely to be missed. A payment codebase with no tests is the single weakest thing about Dejavu today.

---

## 2. Managed Postgres + Versioned Migrations

**Build**
- `db.t4g.micro` Postgres in a private subnet; SG allows 5432 only from the application SG.
- `init-scripts/` becomes numbered, reversible migrations (node-pg-migrate or Flyway).
- Supabase client replaced with `pg` or Prisma; explicit connection pooling.
- Automated backups with PITR; **actually perform a restore once** and write down the steps.
- Postgres container stays in `docker-compose.yml` so local and deployed schemas match.

**The depth is in the network boundary and the schema lifecycle.** Supabase gave you a database over the public internet with a key. Replacing it forces you to decide what may talk to what, and to treat schema as versioned code rather than a script you ran once.

**Be ready to answer**
- Draw the VPC. Which subnets are public, which are private, and what does the private one use for outbound traffic — NAT gateway, VPC endpoints, or nothing? What did that cost you?
- Why security-group-referencing instead of CIDR ranges?
- Your API is stateless and may run multiple tasks. Where does connection pooling live, and what happens when tasks × pool size exceeds `max_connections`?
- How do you add a NOT NULL column to a live table without downtime?
- You have PITR configured. Walk through recovering from an accidental `DELETE FROM orders` at 3pm.

**Bullet:** *Migrated the persistence layer off a BaaS provider to AWS RDS PostgreSQL in a private subnet with security-group-scoped access, versioned reversible migrations, explicit connection pooling, and a tested point-in-time recovery procedure.*

---

## 3. Terraform + GitHub OIDC + Secrets Manager

**Build**
- Terraform modules for VPC, RDS, ECR, ECS, ALB, IAM. Remote state in S3, locking in DynamoDB.
- `terraform plan` posted on PR; `apply` behind a protected environment.
- GitHub Actions assumes an AWS role via OIDC — no static access keys exist anywhere.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, DB credentials all move to Secrets Manager, injected at task runtime.
- Separate `dev` and `prod` state.

**The depth is in credential design, and you have lived the failure case.** You leaked keys and rotated them. The interesting version of that story is not "I was careless" — it is "I concluded that any credential a human can copy will eventually leak, so I removed the humans and the copies." That reasoning is what separates someone who had an incident from someone who learned from one.

**Be ready to answer**
- Explain the OIDC trust flow. What does GitHub present, what validates it, and what stops another repository from assuming your role?
- Why is state remote, and what specifically goes wrong without DynamoDB locking?
- Secrets Manager versus SSM Parameter Store — you picked one; defend it on cost and rotation.
- Secrets are injected into the task at runtime. Are they visible in the task definition? In `docker inspect`? In CloudWatch logs if something dumps `process.env`?
- What is your IAM policy for the deploy role, and how did you narrow it beyond `ecs:*`?
- What is not in Terraform, and why?

**Bullet:** *Codified the full AWS footprint in Terraform with remote state locking and plan-on-PR review; eliminated static cloud credentials entirely by federating CI through GitHub OIDC and relocating application secrets to AWS Secrets Manager following a credential exposure incident.*

> Highest-signal item on the list. It also makes the whole stack disposable — `destroy` after a demo, `apply` before an interview, and the bill stays near zero.

---

## 4. Containerized Backend on Fargate + ALB

*(absorbs the original image-hygiene item)*

**Build**
- Multi-stage Dockerfiles, non-root user, `.dockerignore` excluding `.env`; Buildx with GHA layer caching.
- ECR with a lifecycle policy; images tagged by git SHA, never deployed by `latest`.
- Trivy scan failing the build on HIGH/CRITICAL; gitleaks + GitHub push protection on the repo.
- Fargate service behind an ALB, ACM certificate, `/health` endpoint gating rollout.
- CloudWatch log group, structured JSON logging, request IDs.

**The depth is in the rollout mechanics and the sizing decisions.** Skip autoscaling — you cannot defend it at zero traffic, and claiming it on a resume invites a question you will lose.

**Be ready to answer**
- Why Fargate over EC2-backed ECS, or over Lambda with the Web Adapter? What are you paying for, and what did you give up?
- How did you size CPU and memory? What happens to a Node process at the memory limit?
- What does `/health` actually check? Should it check the database — and what happens to your whole service if it does and the DB blips?
- A deploy starts. Walk through the minimum-healthy-percent and maximum-percent settings, and what a user mid-request experiences.
- Stripe posts webhooks to your ALB. How does signature verification survive the load balancer? What about body parsing — raw versus JSON?
- Why tag by SHA instead of `latest`?

**Bullet:** *Deployed a containerized Node/Express API to AWS ECS Fargate behind an Application Load Balancer with SHA-pinned ECR images, health-gated rolling deploys, structured CloudWatch logging, and Trivy scanning enforced at build time.*

---

## 5. Integration + E2E Against Real Dependencies

*(absorbs webhook idempotency from the original event-driven item)*

**Build**
- Postgres as a GitHub Actions service container; migrations run, then Supertest hits a real database.
- Stripe CLI replays webhook fixtures in CI against the real `webhookController` — signature verification tested for real, in test mode.
- **Idempotency proven by test:** replay the same `checkout.session.completed` event three times, assert one order and one inventory decrement. Enforced by a unique constraint on the Stripe event ID.
- Playwright E2E over the compose stack: browse → cart → checkout → webhook → order visible in admin.
- Traces and screenshots uploaded as artifacts on failure.

**The depth is in webhook correctness, which is genuinely hard and scale-independent.** Stripe guarantees at-least-once delivery. Events arrive out of order, duplicated, and occasionally after you have already timed out and it retried. Handling that correctly is real distributed-systems reasoning — the queue was never the interesting part, this is.

**Be ready to answer**
- Stripe delivers at-least-once. Where exactly does your idempotency live, and why a unique constraint rather than a check-then-insert?
- `payment_intent.succeeded` arrives before `checkout.session.completed`. What does your handler do?
- Your handler decrements inventory and writes an order. Are those in one transaction? What if the process dies between them?
- Two customers buy the last item simultaneously. What prevents overselling — and did you use a transaction, a row lock, or a check constraint?
- Why a real Postgres in CI when you already mock it in unit tests?
- How do you seed and isolate test data so tests can run in any order?

**Bullet:** *Built an integration suite executing against ephemeral Postgres service containers and Playwright E2E coverage of the full checkout path, including replayed Stripe webhook fixtures proving idempotent order fulfillment under at-least-once delivery.*

---

## 6. Staging → Production CD with Rollback

**Build**
- Merge to `main` → auto-deploy to staging. Production requires manual approval on a protected environment.
- Migrations run as an explicit pre-deploy step with a documented rollback path.
- Post-deploy smoke test against the ALB; failure auto-rolls back to the previous task definition.
- `/version` endpoint returning the deployed git SHA.
- CloudWatch alarm on 5xx rate and on failed-checkout count, routed to SNS.

**The depth is in the ordering problem, which has no clean answer and everyone who has shipped knows it.** Code and schema deploy at different moments; for a window, one version of the app runs against the other version of the schema. Reasoning through that window is a strong signal.

**Be ready to answer**
- Migrations run before the new code. So old code is briefly running against the new schema — what constraints does that put on every migration you write?
- You need to rename a column. Walk through the expand/contract sequence and how many deploys it takes.
- Rollback reverts the task definition. Does it revert the migration? If not, what does "rollback" actually mean, and when is it unsafe?
- What does your smoke test check, and why not more? What is the cost of a slow smoke test?
- Why manual approval for production when everything is automated? What is that gate actually protecting?
- Staging shares nothing with production, or shares something? What did you decide about the database, and what did it cost?

**Bullet:** *Implemented staging-to-production continuous deployment with protected-environment approval gates, expand/contract migration sequencing, post-deploy smoke verification, and automatic rollback to the last healthy revision; instrumented CloudWatch alarms on error and failed-checkout rates.*

---

## Two Honesty Rules

**Do not claim what the traffic does not support.** No "optimized for scale," no "high availability," no autoscaling bullets on a one-task service. Every one of those invites a question whose honest answer undercuts you. The bullets above claim correctness, reproducibility, and safety — all true at one user.

**Have a "what I would do differently" answer for each item.** The most convincing thing you can say about the SQS decoupling you deliberately skipped is that you considered it, understood what it buys, and concluded the project did not have the problem it solves. Deliberate omission is a stronger signal than unnecessary inclusion — but only if you can articulate it.

---

## Cost Control

| Control | Note |
|---|---|
| AWS Budgets alarm at $5 | Set before provisioning anything |
| `terraform destroy` between demos | The entire stack rebuilds in minutes |
| RDS free tier | Verify current terms — the structure changed in 2025 |
| Lambda Web Adapter instead of Fargate | Scales to zero; slightly weaker bullet, materially cheaper |
| Homelab for always-on | The cloud copy only needs to exist when someone is looking at it |
