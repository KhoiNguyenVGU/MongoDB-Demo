# Prompt: Build web demo MongoDB (CRUD + Dashboard) trên dữ liệu sample_mflix

## Bối cảnh
Đây là project demo cho môn DBMS. Mục tiêu là cho thấy các thao tác MongoDB thật (CRUD, aggregation pipeline, index, text search, geospatial query) qua một web app gọn, đẹp, chạy được bằng một lệnh.

Thư mục hiện tại đã có file `.env`:
```
MONGODB_URI=...      # chuỗi kết nối MongoDB Atlas (replica set, ssl=true, authSource=admin)
MONGODB_DB=sample_mflix
PORT=3000
```
**Không được hardcode connection string trong code, không in nó ra log, không commit `.env`.** Luôn đọc từ `process.env` (dùng `dotenv`).

## Tech stack
- Node.js 24 + Express
- **MongoDB Node.js native driver** (`mongodb` v6), KHÔNG dùng Mongoose, để code thể hiện rõ query MongoDB (`find`, `insertOne`, `updateOne`, `deleteOne`, `aggregate`...)
- Frontend: HTML + vanilla JS (hoặc Alpine.js) + Tailwind CSS qua CDN + Chart.js, do Express phục vụ từ thư mục `public/`
- Chạy bằng `npm install` rồi `npm start` (có `npm run dev` dùng `node --watch`)
- Một `MongoClient` dùng chung (singleton), kết nối khi khởi động, `ping` để kiểm tra, đóng khi SIGINT

## Dữ liệu thực tế (đã kiểm tra)
Database `sample_mflix`:

| Collection | Số docs | Field chính |
|---|---|---|
| `movies` | ~21,349 | `title`, `year` (int), `genres[]`, `runtime`, `cast[]`, `directors[]`, `writers[]`, `plot`, `fullplot`, `poster` (URL), `released` (Date), `rated`, `languages[]`, `countries[]`, `type` (`"movie"` / `"series"`), `imdb {rating, votes, id}`, `tomatoes {viewer {rating, numReviews, meter}, critic {...}}`, `awards {wins, nominations, text}`, `num_mflix_comments` |
| `comments` | ~41,079 | `movie_id` (ObjectId → `movies._id`), `name`, `email`, `text`, `date` (Date) |
| `users` | 190 | `name`, `email`, `password` (bcrypt hash) |
| `theaters` | 1,564 | `theaterId`, `location.address {street1, city, state, zipcode}`, `location.geo` (GeoJSON Point `[lng, lat]`) |

Bỏ qua `sessions` và `embedded_movies`.

Database `movie_demo`, collection `watchlist` (3 docs): `title`, `year`, `genres[]`, `watched` (bool), `myRating` (optional, 1–10).

**Index đã có:**
- movies: text index (`_fts`), `{runtime:1}`, `{genres:1, "imdb.rating":-1}`, `{year:-1}`
- comments: `{email:1}`, `{movie_id:1, date:-1}`
- users: `{email:1}`
- theaters: `{"location.geo":"2dsphere"}`

**Dữ liệu bẩn cần xử lý:**
- 35 movies có `year` không phải int (vd. chuỗi `"2012è"`). Trong aggregation, lọc `{year: {$type: "int"}}` hoặc dùng `$convert` với `onError`.
- 61 movies có `imdb.rating` không phải number (chuỗi rỗng `""`). Lọc `{"imdb.rating": {$type: "number"}}` trước khi `$avg`/sort.
- 3,305 movies không có `poster`, và một số URL poster bị hỏng. Frontend phải có ảnh placeholder (`onerror`).
- Năm phát hành nằm trong khoảng 1896–2016.

## Tính năng cần làm

### 1. Dashboard (trang chủ `/`)
Mỗi biểu đồ lấy dữ liệu từ một endpoint chạy **aggregation pipeline** ở server (không kéo toàn bộ dữ liệu về client):
- KPI cards: tổng số movies, comments, users, theaters; IMDb rating trung bình
- Bar chart: top 10 thể loại theo số phim (`$unwind` genres → `$group` → `$sort` → `$limit`)
- Line chart: số phim theo thập kỷ (`$match` year int → `$group` theo `$multiply: [{$floor: {$divide: ["$year", 10]}}, 10]`)
- Bar chart: IMDb rating trung bình theo thể loại (chỉ tính thể loại có ≥ 100 phim)
- Doughnut: tỉ lệ `type` movie vs series
- Bảng: top 10 phim được bình luận nhiều nhất (`$group` trên comments theo movie_id → `$lookup` sang movies)
- Bar chart: top 10 bang (state) có nhiều rạp nhất
- Có bộ lọc chung theo thể loại và khoảng năm, áp dụng cho các chart (truyền thành `$match` đầu pipeline)

### 2. Movies, CRUD đầy đủ (`/movies`)
- **List:** dạng grid card (poster, title, year, genres, IMDb rating), phân trang server-side (`skip`/`limit`, trả kèm `total`), sort theo year / rating / title
- **Search & filter:** ô tìm kiếm dùng `$text` (text index đã có) kèm sort theo `textScore`; lọc theo genre (multi-select), khoảng năm, rating tối thiểu, type
- **Detail** (`/movies/:id`): đầy đủ thông tin + danh sách comments của phim (dùng index `movie_id, date`), phân trang comments
- **Create / Edit:** form có validation cả client và server (title bắt buộc, year 1880–2030, rating 0–10, genres là mảng, cast/directors nhập dạng tag). Khi update dùng `$set` chỉ các field thay đổi, đồng thời cập nhật `lastupdated`.
- **Delete:** có modal xác nhận; xóa phim thì xóa luôn comments liên quan (`deleteMany({movie_id})`). Nếu được thì dùng transaction (replica set có hỗ trợ).

### 3. Comments CRUD
- Trong trang detail của phim: thêm, sửa, xóa comment. Khi thêm hoặc xóa, cập nhật `num_mflix_comments` của phim bằng `$inc`.

### 4. Theaters (`/theaters`)
- List + CRUD đơn giản (address + tọa độ)
- "Tìm rạp gần tôi": nhập lat/lng (hoặc dùng `navigator.geolocation`), query `$near` / `$geoNear` trong bán kính X km, hiển thị khoảng cách. Có thêm bản đồ Leaflet (CDN) để hiển thị marker.

### 5. Users (`/users`)
- List + CRUD. **Không bao giờ trả field `password` về client** (dùng projection `{password: 0}`). Khi tạo user mới thì hash password bằng `bcryptjs`. Email phải unique: kiểm tra trước khi insert và trả lỗi 409 nếu trùng.

### 6. Watchlist (`/watchlist`), dùng DB `movie_demo`
- CRUD đơn giản, toggle `watched`, chấm `myRating`. Mục này để minh họa thao tác trên một database thứ hai trong cùng cluster.

### 7. Trang "Query Explorer" (điểm cộng cho môn DBMS)
- Mỗi chart / list có nút "Xem query" hiển thị filter / pipeline MongoDB đã chạy (JSON đẹp) và thời gian thực thi
- Có trang chạy `explain("executionStats")` cho một số query mẫu, để so sánh có index và không có index (`totalDocsExamined` vs `nReturned`, IXSCAN vs COLLSCAN)

## REST API (gợi ý)
```
GET    /api/stats/overview | /genres | /decades | /rating-by-genre | /types | /top-commented | /theaters-by-state
GET    /api/movies?q=&genres=&yearFrom=&yearTo=&minRating=&type=&sort=&page=&limit=
GET    /api/movies/:id
POST   /api/movies
PUT    /api/movies/:id
DELETE /api/movies/:id
GET    /api/movies/:id/comments?page=
POST   /api/movies/:id/comments
PUT    /api/comments/:id
DELETE /api/comments/:id
GET|POST|PUT|DELETE /api/theaters[/:id]    + GET /api/theaters/near?lat=&lng=&km=
GET|POST|PUT|DELETE /api/users[/:id]
GET|POST|PUT|DELETE /api/watchlist[/:id]
```
- Validate `ObjectId` (`ObjectId.isValid`), trả 400 nếu sai, 404 nếu không tìm thấy
- `limit` tối đa 50; escape regex khi dùng `$regex`
- Middleware xử lý lỗi tập trung, trả JSON `{error: message}`

## Cấu trúc thư mục
```
server.js
src/db.js                 # MongoClient singleton
src/routes/*.js           # movies, comments, theaters, users, watchlist, stats
src/utils/validate.js
public/index.html         # dashboard
public/movies.html, movie.html, theaters.html, users.html, watchlist.html, explorer.html
public/js/*.js, public/css/app.css
README.md                 # cách chạy + danh sách query MongoDB được demo
```

## UI/UX
- Navbar cố định, responsive (dùng được trên mobile), có dark mode
- Toast thông báo khi tạo / sửa / xóa thành công hoặc lỗi; có loading skeleton khi fetch
- Giao diện tiếng Việt hoặc tiếng Anh, nhưng phải thống nhất

## Quy trình làm việc
1. Kết nối DB, chạy `listCollections` và lấy vài document mẫu để xác nhận schema ở trên, trước khi code
2. Dựng backend + API, test từng endpoint bằng `curl`
3. Làm frontend, chạy `npm start` và mở thử từng trang
4. Không xóa hay sửa dữ liệu gốc khi test. Khi test CRUD, tạo document có title bắt đầu bằng `[TEST]` rồi xóa nó sau khi test xong.
5. Viết README: cách chạy, ảnh chụp các trang, và bảng liệt kê các kỹ thuật MongoDB đã dùng (CRUD, `$lookup`, `$unwind`, `$group`, `$text`, `$geoNear`, index, transaction, explain)
