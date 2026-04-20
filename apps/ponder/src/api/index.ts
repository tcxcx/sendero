import { Hono } from 'hono';
import { graphql, client } from 'ponder';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

const app = new Hono();

// GraphQL playground + query endpoint at /graphql
app.use('/graphql', graphql({ db, schema }));

// Direct SQL query endpoint for custom aggregations
app.use('/sql/*', client({ db, schema }));

export default app;
