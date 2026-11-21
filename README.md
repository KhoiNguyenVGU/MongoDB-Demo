# MFlix · MongoDB Demo

Web demo CRUD + Dashboard trên MongoDB Atlas (dataset `sample_mflix` và `movie_demo`), làm cho môn DBMS.

**Stack:** Node.js + Express 5 + MongoDB Node.js native driver (không dùng Mongoose, để thấy rõ từng query) · Frontend dùng HTML + vanilla JS + Tailwind (CDN) + Chart.js + Leaflet.

## Chạy

```bash
npm install
npm start          # hoặc: npm run dev  (tự restart khi sửa code)
```

Mở http://localhost:3000

Cấu hình nằm trong `.env` (không commit file này):

```
MONGODB_URI=mongodb://...      # connection string Atlas
MONGODB_DB=sample_mflix
PORT=3000
```

Nếu không kết nối được, kiểm tra **Network Access** trên Atlas: IP của máy bạn phải nằm trong whitelist.

## Deploy lên Render

Repo có sẵn [`render.yaml`](render.yaml) (Blueprint).

1. **Atlas → Network Access → Add IP Address → `0.0.0.0/0`**. Gói free của Render không có IP cố định nên phải mở cho mọi IP. Vì vậy hãy dùng mật khẩu DB mạnh.
2. **Render → New → Blueprint** → chọn repo này → Render tự đọc `render.yaml`.
3. Nhập giá trị cho các biến secret:
   - `MONGODB_URI`: connection string Atlas
   - `DEMO_PASSWORD`: mật khẩu để vào web (user: `demo`). Để trống nếu muốn web công khai, nhưng khi đó ai có link cũng có thể sửa hoặc xóa dữ liệu.
4. **Apply**. Sau khoảng 2–3 phút web chạy tại `https://<tên-service>.onrender.com`.

Mỗi lần `git push` lên `main`, Render tự deploy lại. Gói free sẽ "ngủ" sau 15 phút không có truy cập; lần mở đầu tiên sau đó mất khoảng 30–50 giây để khởi động.

## Các trang

| Trang | Nội dung |
|---|---|
| `/` Dashboard | 5 KPI, 5 biểu đồ, bảng top phim nhiều comment. Có bộ lọc thể loại và khoảng năm, được truyền vào `$match` đầu pipeline |
| `/movies` | Grid phim: full-text search, lọc theo thể loại/năm/rating/loại, sort, phân trang server-side, thêm phim |
| `/movies/:id` | Chi tiết phim, sửa/xóa phim, CRUD comments |
| `/theaters` | CRUD rạp, bản đồ Leaflet, tìm rạp gần một điểm (bấm lên bản đồ) |
| `/users` | CRUD user: password hash bằng bcrypt, không bao giờ trả về client, email unique (409) |
| `/sandbox` | Duyệt mọi database bạn tự tạo (ẩn `admin`/`local`/`config` và `sample_*`): tạo/drop database và collection; thêm, sửa (`replaceOne`), xóa, lọc document dạng JSON |
| `/explorer` | 3 tab: **Bài tập** (8 bài trong tài liệu "MongoDB Demo Exercise", chạy từng query trên Atlas), **Index vs COLLSCAN**, **Tự viết query** (`find()` chỉ đọc) |

### Tab Bài tập (Query Explorer)

- Nội dung bài lấy nguyên văn từ tài liệu; query nằm ở [`src/exercises.js`](src/exercises.js). Mỗi query gồm lệnh mongosh để hiển thị và code driver tương đương để chạy.
- Chỉ các query định nghĩa sẵn mới chạy được (`POST /api/exercises/run/:id`); client không gửi được query tùy ý.
- Bài 3 mặc định chạy trên `movie_demo.watchlist` như tài liệu, nhưng có thể đổi sang tên database/collection khác. Lựa chọn được lưu trong trình duyệt và lệnh mongosh hiển thị tự cập nhật theo. Database hệ thống và `sample_*` bị chặn ở server. Các bước Delete, Drop và dropIndex có hộp thoại xác nhận trước khi chạy.
- Thanh trạng thái hiển thị số document trong collection của Bài 3 (bấm vào để mở trong Sandbox) và cho biết index `runtime_1` có đang tồn tại không. Nếu index còn, bước "Without index" của Bài 7 sẽ vẫn dùng IXSCAN.

Mọi danh sách/biểu đồ đều có nút **`{ } xx ms`** để xem query MongoDB đã chạy (cú pháp mongosh). Sau mỗi thao tác thêm/sửa/xóa, toast hiện link **Xem query**.

## Kỹ thuật MongoDB được demo

| Kỹ thuật | Ở đâu | File |
|---|---|---|
| `find` + projection + sort + `skip`/`limit` | Danh sách movies, theaters, users | `src/routes/movies.js` |
| `insertOne`, `findOneAndUpdate` (`$set`/`$unset`), `deleteOne` | Tất cả trang CRUD | `src/routes/*.js` |
| Update một phần: chỉ `$set` các field đã thay đổi | Sửa phim | `public/js/movie-form.js` |
| `$text` search + sort theo `textScore` | Ô tìm kiếm Movies | `src/routes/movies.js` |
| `$regex` (đã escape) không phân biệt hoa thường | Tìm users, theaters | `src/routes/users.js` |
| Aggregation: `$match`, `$unwind`, `$group`, `$sort`, `$limit`, `$project`, `$round`, `$floor` | Dashboard | `src/routes/stats.js` |
| `$lookup` (join comments → movies, có sub-pipeline) | Top phim nhiều comment | `src/routes/stats.js` |
| `$geoNear` + index `2dsphere` (GeoJSON Point) | Tìm rạp gần | `src/routes/theaters.js` |
| Multi-document **transaction** | Xóa phim + comments; thêm/xóa comment + `$inc` counter | `src/routes/movies.js`, `comments.js` |
| `$inc` để giữ counter `num_mflix_comments` khớp với dữ liệu | Comments | `src/routes/comments.js` |
| Index: single, compound, text, 2dsphere | Explorer | `src/routes/explain.js` |
| `explain("executionStats")` + `hint({ $natural: 1 })` | So sánh IXSCAN và COLLSCAN | `src/routes/explain.js` |
| `distinct` | Dropdown thể loại, bang | `src/routes/movies.js` |
| Dữ liệu bẩn: lọc bằng `$type` | 35 phim có `year` là chuỗi, 61 phim có `imdb.rating` rỗng | `src/routes/stats.js` |
| Liệt kê database/collection, `createCollection`, `drop`, `dropDatabase`, `replaceOne` | Sandbox | `src/routes/sandbox.js` |

## Cấu trúc

```
server.js                 Express app, error handler, kết nối DB khi khởi động
src/db.js                 MongoClient singleton
src/utils/validate.js     validate input, ObjectId, phân trang, mô tả query
src/routes/               stats, movies, comments, theaters, users, sandbox, explain, exercises
src/exercises.js          nội dung + query của các bài tập
public/                   các trang HTML + js/ + css/
```

## API

```
GET    /api/stats/overview | genres | decades | rating-by-genre | types | top-commented | theaters-by-state
GET    /api/movies?q=&genres=&yearFrom=&yearTo=&minRating=&type=&sort=&page=&limit=
GET    /api/movies/genres
GET    /api/movies/:id          POST /api/movies      PUT/DELETE /api/movies/:id
GET    /api/movies/:id/comments POST /api/movies/:id/comments
PUT    /api/comments/:id        DELETE /api/comments/:id
GET    /api/theaters?q=&state=  GET /api/theaters/near?lat=&lng=&km=   POST/PUT/DELETE /api/theaters[/:id]
GET    /api/users?q=            POST/PUT/DELETE /api/users[/:id]
GET    /api/sandbox/databases   POST /api/sandbox/databases   DELETE /api/sandbox/databases/:db
POST   /api/sandbox/databases/:db/collections   DELETE /api/sandbox/databases/:db/collections/:coll
GET|POST|PUT|DELETE /api/sandbox/databases/:db/collections/:coll/docs   (PUT/DELETE: body { id })
GET    /api/exercises           GET /api/exercises/state?db=&collection=   POST /api/exercises/run/:id
GET    /api/explain/samples     GET /api/explain/run/:key   POST /api/explain/custom
```

Lỗi luôn trả về JSON `{ "error": "..." }`: 400 khi dữ liệu không hợp lệ, 404 khi không tìm thấy, 409 khi trùng dữ liệu.

> **Lưu ý:** thao tác thêm/sửa/xóa ghi thẳng vào dữ liệu thật trên Atlas. Khi demo, nên tạo document mới rồi xóa chính nó, tránh xóa dữ liệu gốc.
