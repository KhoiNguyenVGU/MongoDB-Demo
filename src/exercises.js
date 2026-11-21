// Bài tập từ tài liệu "MongoDB Demo Exercise".
// Mỗi query có: shell (hiển thị đúng như tài liệu) + run (code driver tương đương, chạy trên Atlas).
// Chỉ các query định nghĩa ở đây mới chạy được: client không gửi query tùy ý.
const { summarize } = require('./utils/explain');

// Bài 3 chạy trên database/collection do người dùng chọn (mặc định movie_demo.watchlist như tài liệu)
const wl = (ctx) => ctx.target.collection;
const movies = (ctx) => ctx.mflix().collection('movies');

const updateResult = (r) => ({
  acknowledged: r.acknowledged,
  insertedId: r.upsertedId ?? null,
  matchedCount: r.matchedCount,
  modifiedCount: r.modifiedCount,
  upsertedCount: r.upsertedCount,
});

async function explainResult(cursor) {
  const ex = await cursor.explain('executionStats');
  const es = ex.executionStats || {};
  return {
    kind: 'explain',
    value: {
      summary: summarize(ex),
      executionStats: {
        executionSuccess: es.executionSuccess,
        nReturned: es.nReturned,
        executionTimeMillis: es.executionTimeMillis,
        totalKeysExamined: es.totalKeysExamined,
        totalDocsExamined: es.totalDocsExamined,
        executionStages: es.executionStages,
      },
    },
  };
}

const EXERCISES = [
  {
    no: 1,
    title: 'Atlas setup',
    setup: true,
    steps: [
      'Sign in at mongodb.com/atlas.',
      'Create a project. Open the project menu, choose New Project, and click Create Project.',
      'Create a cluster. Click Create (or Build a Database) and choose M0 Free. Pick the provider and region closest to you, name the cluster, and click Create.',
      'Copy the username and password to your notes',
      'Load sample data. On the cluster card, open the ... menu and choose Load Sample Dataset.',
      'Browse. Click Browse Collections and open sample_mflix > movies.',
    ],
  },
  {
    no: 2,
    title: 'Compass setup',
    setup: true,
    steps: [
      'Download MongoDB Compass',
      'Get the string. In Atlas, click Connect on your cluster, choose Compass, and copy the connection string. Replace <password> with your copied password.',
      'Connect. In Compass, click Add new connection, paste the string, and click Connect.',
    ],
  },
  {
    no: 3,
    title: 'CRUD on your own data',
    db: 'movie_demo',
    configurable: true, // client có thể đổi tên database/collection
    intro: 'In this section, we will create our own database (movie_demo) and perform CRUD operations on it.',
    parts: [
      {
        name: 'Create',
        tasks: [
          'Create a new database called “movie_demo”',
          'Insert 1 document with title: “Inception”, year: 2010, genre: “Sci-Fi” and “Thriller”, watched: false',
          'Insert 2 more documents with one command: title: “The Dark Knight”, year: 2008, genres: “Action” and “Crime”, watched: true, myRating: 9; and title: “Interstellar”, year: 2014, genres: “Sci-Fi” and “Drama”, watched: false',
        ],
        queries: [
          {
            id: '3-use',
            shell: 'use movie_demo',
            note: 'MongoDB chỉ thực sự tạo database khi có document đầu tiên được insert.',
            run: async (ctx) => `switched to db ${ctx.target.dbName}`,
          },
          {
            id: '3-insertOne',
            write: true,
            shell: 'db.watchlist.insertOne({ title: "Inception", year: 2010, genres: ["Sci-Fi", "Thriller"], watched: false })',
            run: async (ctx) => {
              const r = await wl(ctx).insertOne({ title: 'Inception', year: 2010, genres: ['Sci-Fi', 'Thriller'], watched: false });
              return { acknowledged: r.acknowledged, insertedId: r.insertedId };
            },
          },
          {
            id: '3-insertMany',
            write: true,
            shell: 'db.watchlist.insertMany([\n  { title: "The Dark Knight", year: 2008, genres: ["Action", "Crime"], watched: true, myRating: 9 },\n  { title: "Interstellar", year: 2014, genres: ["Sci-Fi", "Drama"], watched: false }\n])',
            run: async (ctx) => {
              const r = await wl(ctx).insertMany([
                { title: 'The Dark Knight', year: 2008, genres: ['Action', 'Crime'], watched: true, myRating: 9 },
                { title: 'Interstellar', year: 2014, genres: ['Sci-Fi', 'Drama'], watched: false },
              ]);
              return { acknowledged: r.acknowledged, insertedIds: r.insertedIds };
            },
          },
        ],
      },
      {
        name: 'Read',
        tasks: [
          'Find all movies in the watchlist with the genre “Sci-Fi”',
          'Find all movies not yet watched, showing only their titles (hide the _id)',
        ],
        queries: [
          {
            id: '3-find-scifi',
            shell: 'db.watchlist.find({ genres: "Sci-Fi" })',
            run: (ctx) => wl(ctx).find({ genres: 'Sci-Fi' }).toArray(),
          },
          {
            id: '3-find-unwatched',
            shell: 'db.watchlist.find({ watched: false }, { _id: 0, title: 1 })',
            run: (ctx) => wl(ctx).find({ watched: false }, { projection: { _id: 0, title: 1 } }).toArray(),
          },
        ],
      },
      {
        name: 'Update',
        tasks: [
          'Mark “Inception” as watched and give it a rating of 9',
          'Add the tag “favorite” to every Sci-Fi movie',
        ],
        queries: [
          {
            id: '3-updateOne',
            write: true,
            shell: 'db.watchlist.updateOne({ title: "Inception" }, { $set: { watched: true, myRating: 9 } })',
            run: async (ctx) => updateResult(await wl(ctx).updateOne({ title: 'Inception' }, { $set: { watched: true, myRating: 9 } })),
          },
          {
            id: '3-updateMany',
            write: true,
            shell: 'db.watchlist.updateMany({ genres: "Sci-Fi" }, { $set: { tag: "favorite" } })',
            run: async (ctx) => updateResult(await wl(ctx).updateMany({ genres: 'Sci-Fi' }, { $set: { tag: 'favorite' } })),
          },
        ],
      },
      {
        name: 'Delete',
        tasks: ['Remove “The Dark Knight” from the watchlist'],
        queries: [
          {
            id: '3-deleteOne',
            write: true,
            danger: 'Xóa document “The Dark Knight” khỏi {db}.{coll}.',
            shell: 'db.watchlist.deleteOne({ title: "The Dark Knight" })',
            run: async (ctx) => {
              const r = await wl(ctx).deleteOne({ title: 'The Dark Knight' });
              return { acknowledged: r.acknowledged, deletedCount: r.deletedCount };
            },
          },
        ],
      },
      {
        name: 'Count',
        tasks: ['Count how many movies are left in the watchlist'],
        queries: [
          {
            id: '3-count',
            shell: 'db.watchlist.countDocuments()',
            run: (ctx) => wl(ctx).countDocuments(),
          },
        ],
      },
      {
        name: 'Drop',
        tasks: ['Drop the movie_demo database'],
        queries: [
          {
            id: '3-drop',
            write: true,
            danger: 'Xóa TOÀN BỘ database {db} (mọi collection trong đó). Chạy lại phần Create để tạo lại.',
            shell: 'db.dropDatabase()',
            run: async (ctx) => {
              await ctx.target.db.dropDatabase();
              return { ok: 1, dropped: ctx.target.dbName };
            },
          },
        ],
      },
    ],
  },
  {
    no: 4,
    title: 'Sorting + Limit',
    db: 'sample_mflix',
    intro: 'From this section onwards, we will be working with the sample_mflix database. In this section, we will use the sorting and limit functions for our queries.',
    parts: [
      {
        name: 'Sort + Limit',
        tasks: ['In sample_mflix, find all Sci-Fi movies and show only the title, year and IMDb rating (hide the _id). Sort them by IMDb rating from lowest to highest and return only the first 3'],
        queries: [
          {
            id: '4-sort-limit',
            shell: 'db.movies.find(\n  { genres: "Sci-Fi" },\n  { _id: 0, title: 1, year: 1, "imdb.rating": 1 }\n).sort({ "imdb.rating": 1 }).limit(3)',
            run: (ctx) => movies(ctx).find({ genres: 'Sci-Fi' }, { projection: { _id: 0, title: 1, year: 1, 'imdb.rating': 1 } }).sort({ 'imdb.rating': 1 }).limit(3).toArray(),
          },
        ],
      },
      {
        name: 'Sort on 2 fields',
        tasks: ['Find all Sci-Fi movies and show only the title and year. Sort them by year, then by title, both ascending, and return only the first 5'],
        queries: [
          {
            id: '4-sort-two',
            shell: 'db.movies.find(\n  { genres: "Sci-Fi" },\n  { _id: 0, title: 1, year: 1 }\n).sort({ year: 1, title: 1 }).limit(5)',
            run: (ctx) => movies(ctx).find({ genres: 'Sci-Fi' }, { projection: { _id: 0, title: 1, year: 1 } }).sort({ year: 1, title: 1 }).limit(5).toArray(),
          },
        ],
      },
    ],
  },
  {
    no: 5,
    title: 'Comparison + Logical Operators',
    db: 'sample_mflix',
    intro: 'In this section, we will use some comparison and logical operators for our queries.',
    parts: [
      {
        name: 'Comparison operators',
        tasks: [
          'Count the movies released from 2000 up to, but not including, 2010',
          'Count the movies rated “G” or “PG”',
        ],
        queries: [
          {
            id: '5-range',
            shell: 'db.movies.countDocuments({ year: { $gte: 2000, $lt: 2010 } })',
            run: (ctx) => movies(ctx).countDocuments({ year: { $gte: 2000, $lt: 2010 } }),
          },
          {
            id: '5-in',
            shell: 'db.movies.countDocuments({ rated: { $in: ["G", "PG"] } })',
            run: (ctx) => movies(ctx).countDocuments({ rated: { $in: ['G', 'PG'] } }),
          },
        ],
      },
      {
        name: 'Logical operators',
        tasks: [
          'Count the movies released in 2010 or later that are Sci-Fi or Fantasy',
          'Count the Sci-Fi movies whose IMDb rating is not greater than 8',
        ],
        queries: [
          {
            id: '5-or',
            shell: 'db.movies.countDocuments({\n  year: { $gte: 2010 },\n  $or: [ { genres: "Sci-Fi" }, { genres: "Fantasy" } ]\n})',
            run: (ctx) => movies(ctx).countDocuments({ year: { $gte: 2010 }, $or: [{ genres: 'Sci-Fi' }, { genres: 'Fantasy' }] }),
          },
          {
            id: '5-not',
            shell: 'db.movies.countDocuments({ genres: "Sci-Fi", "imdb.rating": { $not: { $gt: 8 } } })',
            note: '$not cũng khớp các document không có imdb.rating hoặc rating không phải số.',
            run: (ctx) => movies(ctx).countDocuments({ genres: 'Sci-Fi', 'imdb.rating': { $not: { $gt: 8 } } }),
          },
        ],
      },
    ],
  },
  {
    no: 6,
    title: 'Group by + Aggregation',
    db: 'sample_mflix',
    intro: 'In this section, we will query with group by and perform aggregations.',
    parts: [
      {
        name: 'Aggregation pipeline',
        tasks: ['Show the top 5 genres with the most movies with their movie counts (a movie with several genres counts once for each genre)'],
        queries: [
          {
            id: '6-top-genres',
            shell: 'db.movies.aggregate([\n  { $unwind: "$genres" },\n  { $group: { _id: "$genres", count: { $sum: 1 } } },\n  { $sort: { count: -1 } },\n  { $limit: 5 }\n])',
            run: (ctx) => movies(ctx).aggregate([
              { $unwind: '$genres' },
              { $group: { _id: '$genres', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 5 },
            ]).toArray(),
          },
        ],
      },
    ],
  },
  {
    no: 7,
    title: 'Index',
    db: 'sample_mflix',
    intro: 'In this section, we will use indexing and compare the performance when and when not using index.',
    parts: [
      {
        name: 'Without index',
        tasks: ['Find the movies with a runtime of 142 minutes and look at the execution stats of the query'],
        queries: [
          {
            id: '7-explain-before',
            shell: 'db.movies.find({ runtime: 142 }).explain("executionStats")',
            run: (ctx) => explainResult(movies(ctx).find({ runtime: 142 })),
          },
        ],
      },
      {
        name: 'With index',
        tasks: [
          'Create an index on runtime',
          'View all indexes',
          'Run the same query again and compare its execution stats with the run without the index',
        ],
        queries: [
          {
            id: '7-create',
            write: true,
            shell: 'db.movies.createIndex({ runtime: 1 })',
            run: (ctx) => movies(ctx).createIndex({ runtime: 1 }),
          },
          {
            id: '7-get-1',
            shell: 'db.movies.getIndexes()',
            run: (ctx) => movies(ctx).indexes(),
          },
          {
            id: '7-explain-after',
            shell: 'db.movies.find({ runtime: 142 }).explain("executionStats")',
            run: (ctx) => explainResult(movies(ctx).find({ runtime: 142 })),
          },
        ],
      },
      {
        name: 'Drop index',
        tasks: ['Remove the runtime index', 'Confirm dropped index'],
        queries: [
          {
            id: '7-drop',
            write: true,
            danger: 'Xóa index runtime_1 trên sample_mflix.movies. Có thể tạo lại ở bước createIndex.',
            shell: 'db.movies.dropIndex("runtime_1")',
            run: async (ctx) => {
              const r = await movies(ctx).dropIndex('runtime_1');
              return { nIndexesWas: r.nIndexesWas, ok: r.ok };
            },
          },
          {
            id: '7-get-2',
            shell: 'db.movies.getIndexes()',
            run: (ctx) => movies(ctx).indexes(),
          },
        ],
      },
    ],
  },
  {
    no: 8,
    title: 'AI integration in VS Code',
    setup: true,
    intro: 'In this section, we will set up MongoDB with AI functionalities in VS Code. This uses the MongoDB extension in VS Code together with GitHub Copilot/Claude/Codex/etc.',
    steps: [
      'Install MongoDB extension in VS Code.',
      'Open the MongoDB icon in the sidebar and click Add Connection.',
      'Paste the connection string and connect.',
      'Prompt GitHub Copilot/Claude/Codex/etc. and get answers.',
    ],
  },
];

const QUERY_BY_ID = new Map();
for (const ex of EXERCISES) {
  for (const part of ex.parts || []) {
    for (const q of part.queries) QUERY_BY_ID.set(q.id, { ...q, db: ex.db, configurable: !!ex.configurable });
  }
}

// Bản gửi cho client: bỏ hàm run
function publicExercises() {
  return EXERCISES.map(({ parts, ...ex }) => ({
    ...ex,
    parts: parts?.map((p) => ({ ...p, queries: p.queries.map(({ run, ...q }) => ({ ...q, configurable: !!ex.configurable })) })),
  }));
}

module.exports = { EXERCISES, QUERY_BY_ID, publicExercises };
