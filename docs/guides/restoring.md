# Restoring from a backup

RDS keeps automatic backups of the database: 30 days on production, 7 on staging. It can restore the database as it was at any moment in that time. This guide checks that a restore works, which is worth doing every few months and after big changes. It also covers replacing the database for real ([ADR 73](../adr/0073-production-stage.md)).

Run these with a signed-in profile for the stage's account: `truman` for staging, `truman-prod` for production. The examples use production.

## Checking a restore works

This makes a temporary copy of the database, beside the live one, and compares the two. The live database isn't touched. The copy costs a few cents an hour, so delete it when you're done.

**1. Find the live database, and how it's reached.**

```
aws rds describe-db-instances --profile truman-prod --region us-east-1 \
  --query "DBInstances[?TagList[?Key=='Stage' && Value=='production']].[DBInstanceIdentifier,DBSubnetGroup.DBSubnetGroupName,VpcSecurityGroups[0].VpcSecurityGroupId]" \
  --output text
```

It prints three things: the database's identifier, its subnet group, and its security group.

**2. Restore the newest backup to a copy.**

```
aws rds restore-db-instance-to-point-in-time --profile truman-prod --region us-east-1 \
  --source-db-instance-identifier <identifier> \
  --target-db-instance-identifier truman3-production-restore-check \
  --use-latest-restorable-time \
  --db-subnet-group-name <subnet group> \
  --vpc-security-group-ids <security group> \
  --db-instance-class db.t4g.micro \
  --no-publicly-accessible \
  --no-deletion-protection
aws rds wait db-instance-available --profile truman-prod --region us-east-1 \
  --db-instance-identifier truman3-production-restore-check
```

The wait takes 10 to 30 minutes.

**3. Count rows in each.** The admin task can reach both, since the copy has the same logins and the same firewall. First the live database, using the stack's `AdminCommand` output with this added:

```
--overrides '{"containerOverrides":[{"name":"task","command":["node","apps/cli/src/admin.ts","counts"]}]}'
```

Then the copy. Find its address:

```
aws rds describe-db-instances --profile truman-prod --region us-east-1 \
  --db-instance-identifier truman3-production-restore-check \
  --query "DBInstances[0].Endpoint.Address" --output text
```

Run the same `AdminCommand`, pointing it at the copy:

```
--overrides '{"containerOverrides":[{"name":"task","command":["node","apps/cli/src/admin.ts","counts"],"environment":[{"name":"DATABASE_HOST","value":"<the copy'"'"'s address>"}]}]}'
```

Each prints how many teams, researchers, studies, participants, content items, and events there are, and nothing else. Read both in the log group `/truman3-production/tasks`.
- **The copy's numbers should be the same as the live database's, or a little lower,** for what happened since the newest restorable moment, usually the last five minutes.
- **Anything else** means the backup isn't what it should be.

**4. Delete the copy.**

```
aws rds delete-db-instance --profile truman-prod --region us-east-1 \
  --db-instance-identifier truman3-production-restore-check \
  --skip-final-snapshot --delete-automated-backups
```

**5. Write down that it worked,** with the date and the counts, in the work log.

## Replacing the database for real

If the live database is lost or damaged, restore it the same way, to a new instance, and to the moment just before the damage, with `--restore-time` instead of `--use-latest-restorable-time`. Then point the API at it:

1. Stop the API: `pnpm run deploy -c stage=production -c apiTasks=0`.
2. Restore, as in step 2, with the instance class the stage uses (`db.t4g.small` for production) and deletion protection on.
3. Check it with `counts`, as in step 3.
4. Point the stack at it. The stack makes its own database, so this is a code change. Set the new instance's address in place of the old one, review it, and deploy. Plan for an hour, and test the change on staging first.
5. Start the API, and check the site.

Step 4 is the slow one. A runbook that swaps the database without a code change is worth writing before Truman holds many labs' data.
