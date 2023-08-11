#!/bin/bash
set -e

if [ -z ${PGPASSWORD+x} ]; then
    echo "Can't find ENV variables (PGPASSWORD), have you loaded '.env' environments variable file?"
    exit 1
fi

# delete public schema on db
reset_sql="drop schema IF EXISTS public cascade; drop schema IF EXISTS graphile_worker cascade; create schema public;"
PGPASSWORD=$PGPASSWORD psql -p $PGPORT -h $PGHOST -d $PGDATABASE -U $PGUSER -c "$reset_sql"

# migrate
yarn workspace backend migrate
# seed
yarn workspace backend seed

echo "All done"