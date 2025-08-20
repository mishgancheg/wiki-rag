Для корректной работы с pgvector необходимо зарегистрировать этот тап при создании pool

```typescript
import pgvector from 'pgvector/pg';

const registerTypesFunctions = [pgvector.registerType]
pool.on('connect', async (client: PoolClient) => {
  const { database, processID } = client as unknown as IPoolClientPg;
  if (Array.isArray(registerTypesFunctions)) {
    await Promise.all(registerTypesFunctions.map((fn) => fn(client)));
  }
});
```

Внеси соответствующие коррективы везде, где нужно


====================================

При вставке записей используй такую конструкцию:

"embedding" = '${JSON.stringify(rs.embedding)}',


```typescript
getUpdateSqlFunction: (rs: TDBRecord) => {
  const textSQL = `---
        UPDATE ${TABLE.TXT.DATASET}
        SET 
          "embedding" = '${JSON.stringify(rs.embedding)}',
          "textToEmbed" = ${rs.textToEmbed}
        WHERE "id" = ${rs.id};
        `;
  return textSQL;
},

```
