const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static("public"));

/*
  DEMO USERS
  Demo Unit ဖြစ်လို့ Server restart လုပ်ရင်
  ဒီ data တွေ ပြန်စနိုင်ပါတယ်။
*/

const users = [
  {
    id: "CK-100001",
    phone: "09111111111",
    password: "123456",
    unit: 10000,
    role: "user"
  }
];

/*
  ADMIN ACCOUNT

  Phone    : 09999999999
  Password : admin123
*/

const admin = {
  phone: "09999999999",
  password: "admin123",
  role: "admin"
};


/* =========================
   LOGIN
========================= */

app.post("/api/login", (req, res) => {

  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.json({
      success: false,
      message: "ဖုန်းနံပါတ်နှင့် Password ဖြည့်ပါ"
    });
  }

  /* ADMIN */

  if (
    phone === admin.phone &&
    password === admin.password
  ) {

    return res.json({
      success: true,
      user: {
        phone: admin.phone,
        role: "admin"
      }
    });

  }


  /* USER */

  const user = users.find(
    u =>
      u.phone === phone &&
      u.password === password
  );


  if (!user) {

    return res.json({
      success: false,
      message: "ဖုန်းနံပါတ် သို့မဟုတ် Password မှားနေပါတယ်"
    });

  }


  return res.json({
    success: true,

    user: {
      id: user.id,
      phone: user.phone,
      unit: user.unit,
      role: "user"
    }

  });

});


/* =========================
   REGISTER
========================= */

app.post("/api/register", (req, res) => {

  const { phone, password } = req.body;

  if (!phone || !password) {

    return res.json({
      success: false,
      message: "အချက်အလက်ပြည့်စုံစွာ ဖြည့်ပါ"
    });

  }


  if (users.some(u => u.phone === phone)) {

    return res.json({
      success: false,
      message: "ဒီဖုန်းနံပါတ်နဲ့ အကောင့်ရှိပြီးသားပါ"
    });

  }


  /* Unique ID */

  const newId =
    "CK-" +
    Math.floor(
      100000 +
      Math.random() * 900000
    );


  const newUser = {

    id: newId,

    phone: phone,

    password: password,

    /*
      User ကိုယ်တိုင် Unit ထည့်လို့မရပါ။
      Admin ကပဲ နောက်ပိုင်း ထည့်ပေးမယ်။
    */

    unit: 0,

    role: "user"

  };


  users.push(newUser);


  return res.json({

    success: true,

    user: {

      id: newUser.id,

      phone: newUser.phone,

      unit: newUser.unit,

      role: newUser.role

    }

  });

});


/* =========================
   GET USER
========================= */

app.get("/api/user/:phone", (req, res) => {

  const user = users.find(
    u => u.phone === req.params.phone
  );


  if (!user) {

    return res.json({
      success: false
    });

  }


  return res.json({

    success: true,

    user: {

      id: user.id,

      phone: user.phone,

      unit: user.unit,

      role: user.role

    }

  });

});


/* =========================
   ADMIN — USER LIST
========================= */

app.get("/api/admin/users", (req, res) => {

  return res.json({

    success: true,

    users: users.map(u => ({

      id: u.id,

      phone: u.phone,

      unit: u.unit,

      role: u.role

    }))

  });

});


/* =========================
   ADMIN — ADD DEMO UNIT
========================= */

app.post("/api/admin/add-unit", (req, res) => {

  const {
    adminPhone,
    adminPassword,
    userId,
    amount
  } = req.body;


  /* Admin verification */

  if (
    adminPhone !== admin.phone ||
    adminPassword !== admin.password
  ) {

    return res.json({

      success: false,

      message: "Admin အကောင့်ဖြင့်သာ လုပ်ဆောင်နိုင်ပါတယ်"

    });

  }


  const value = Number(amount);


  if (!value || value <= 0) {

    return res.json({

      success: false,

      message: "Unit ပမာဏမှားနေပါတယ်"

    });

  }


  const user = users.find(
    u => u.id === userId
  );


  if (!user) {

    return res.json({

      success: false,

      message: "User မတွေ့ပါ"

    });

  }


  user.unit += value;


  /* Realtime balance update */

  io.emit(
    "balance_updated",
    {
      userId: user.id,
      unit: user.unit
    }
  );


  return res.json({

    success: true,

    message: "Unit ထည့်ပေးပြီးပါပြီ",

    user: {

      id: user.id,

      phone: user.phone,

      unit: user.unit

    }

  });

});


/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {

  console.log(
    "User connected:",
    socket.id
  );


  socket.on("join_user", userId => {

    socket.join(
      "user_" + userId
    );

  });


  socket.on("disconnect", () => {

    console.log(
      "User disconnected:",
      socket.id
    );

  });

});


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

  res.sendFile(
    __dirname +
    "/public/index.html"
  );

});


/* =========================
   START SERVER
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `CKLottery server running on port ${PORT}`
    );

  }
);
