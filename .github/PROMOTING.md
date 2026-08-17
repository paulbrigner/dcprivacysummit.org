# Promote staging to production

Use this procedure only after the staging site looks correct.
You do not need Git, a terminal, or AWS access.

Bookmark the
[Deploy site workflow](https://github.com/paulbrigner/dcprivacysummit.org/actions/workflows/deploy.yml)
for future promotions.

1. Review [staging.dcprivacysummit.org](https://staging.dcprivacysummit.org/).
2. Confirm the latest **Deploy staging** run is green on the
   [Deploy site workflow](https://github.com/paulbrigner/dcprivacysummit.org/actions/workflows/deploy.yml).
3. On that workflow page, select **Run workflow**.
4. Leave **Branch: main** selected.
5. Check **I verified the staging site and want to promote it to production**.
6. Select the green **Run workflow** button.
7. Open the new run and wait for both **Verify promotion** and
   **Promote and deploy production** to turn green.
8. Review [dcprivacysummit.org](https://dcprivacysummit.org/).

The workflow promotes the exact commit that was successfully deployed to
staging. It stops without changing production if staging has not deployed
successfully, if `main` and `staging` have diverged, or if either branch changes
during the promotion.

If the run turns red, do not push directly to `main` and do not force the
workflow to continue. Open the failed step to retain its error message and ask
the repository administrator to investigate.
