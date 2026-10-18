// Keep the simulation available independently of any future live configuration.
process.env.ARENA_CONTRACT_ADDRESS='';
await import('../server.mjs');
