// ===================== Global State =====================
var myUsername = "";
var opponentName = "";
var myRole = "";           // "host" | "joiner"
var roomCode = "";
var theme = "";
var peer = null;
var conn = null;

var board = [];             // array of 16 {name, img}
var mySecretIndex = -1;     // my own secret, kept private, never synced
var selectedIndex = -1;     // last card clicked, used for guessing
var hiddenSet = new Set();  // locally hidden card positions (not synced)

var gameState = {
  turn: "host",
  needsAnswer: false,
  history: [],       // [{askerRole, question, answererRole, answerText}]
  gameOver: false,
  winner: ""
};

var activeScreen = "lobbyScreen";

// ===================== Screen Management =====================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(function (el) {
    el.classList.remove("active");
  });
  document.getElementById(id).classList.add("active");
  activeScreen = id;
}

function setTopbar() {
  document.getElementById("topbar-theme").textContent = theme ? theme.toUpperCase() : "";
  document.getElementById("topbar-room").textContent = roomCode ? "ROOM " + roomCode : "";
}

function applyThemeBackground(t) {
  document.getElementById("lobbyScreen").setAttribute("data-theme", t || "");
  document.body.setAttribute("data-active-theme", t || "");
}

// ===================== Utilities =====================
function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function pickBoard(t) {
  var pool = PLAYER_DATA[t] || [];
  var shuffled = shuffle(pool);
  return shuffled.slice(0, 16).map(function (p) { return { name: p.name, img: p.img }; });
}

function otherRole(role) {
  return role === "host" ? "joiner" : "host";
}

function nameForRole(role) {
  if (role === myRole) return myUsername || (role === "host" ? "Host" : "Joiner");
  return opponentName || (role === "host" ? "Host" : "Joiner");
}

// ===================== Lobby: username & host/join toggle =====================
var usernameInput = document.getElementById("usernameInput");
usernameInput.addEventListener("input", function () {
  myUsername = usernameInput.value.trim();
  document.getElementById("hostJoinRow").classList.toggle("hidden", myUsername === "");
});

document.getElementById("showHostBtn").addEventListener("click", function () {
  document.getElementById("hostJoinRow").classList.add("hidden");
  document.getElementById("hostSetup").classList.remove("hidden");
});

document.getElementById("showJoinBtn").addEventListener("click", function () {
  document.getElementById("hostJoinRow").classList.add("hidden");
  document.getElementById("joinSetup").classList.remove("hidden");
});

document.querySelectorAll(".back-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    // Tear down any in-progress connection attempt
    teardownPeer();
    document.getElementById("hostSetup").classList.add("hidden");
    document.getElementById("hostWaiting").classList.add("hidden");
    document.getElementById("joinSetup").classList.add("hidden");
    document.getElementById("joinStatusMsg").textContent = "";
    document.getElementById("hostJoinRow").classList.remove("hidden");
  });
});

// ===================== Theme picker (host only) =====================
var selectedTheme = "";
document.querySelectorAll(".theme-tile").forEach(function (tile) {
  tile.addEventListener("click", function () {
    document.querySelectorAll(".theme-tile").forEach(function (t) { t.classList.remove("selected"); });
    tile.classList.add("selected");
    selectedTheme = tile.getAttribute("data-theme");
    applyThemeBackground(selectedTheme);
    document.getElementById("createRoomBtn").disabled = false;
  });
});

document.getElementById("createRoomBtn").addEventListener("click", function () {
  theme = selectedTheme;
  myRole = "host";
  roomCode = generateRoomCode();
  board = pickBoard(theme);
  mySecretIndex = Math.floor(Math.random() * 16);

  document.getElementById("hostSetup").classList.add("hidden");
  document.getElementById("hostWaiting").classList.remove("hidden");
  document.getElementById("roomCodeDisplay").textContent = roomCode;

  startHostPeer();
});

// ===================== Join setup =====================
document.getElementById("joinRoomBtn").addEventListener("click", function () {
  var code = document.getElementById("roomCodeInput").value.trim();
  if (code === "") return;
  roomCode = code;
  myRole = "joiner";
  document.getElementById("joinStatusMsg").textContent = "Connecting…";
  document.getElementById("joinRoomBtn").disabled = true;
  startJoinerPeer(code);
});

// ===================== PeerJS: Host =====================
function startHostPeer() {
  teardownPeer();
  peer = new Peer("gw-" + roomCode);

  peer.on("open", function () {
    document.getElementById("hostWaitingMsg").textContent = "Waiting for player 2 to join…";
  });

  peer.on("connection", function (incoming) {
    conn = incoming;
    attachConnHandlers();
  });

  peer.on("error", function (err) {
    if (err.type === "unavailable-id") {
      roomCode = generateRoomCode();
      document.getElementById("roomCodeDisplay").textContent = roomCode;
      startHostPeer();
    } else {
      document.getElementById("hostWaitingMsg").textContent = "Connection error — try again.";
    }
  });
}

// ===================== PeerJS: Joiner =====================
function startJoinerPeer(code) {
  teardownPeer();
  peer = new Peer();

  peer.on("open", function () {
    conn = peer.connect("gw-" + code, { reliable: true });
    attachConnHandlers();
  });

  peer.on("error", function (err) {
    document.getElementById("joinRoomBtn").disabled = false;
    if (err.type === "peer-unavailable") {
      document.getElementById("joinStatusMsg").textContent = "Room not found. Check the code and try again.";
    } else {
      document.getElementById("joinStatusMsg").textContent = "Connection error — try again.";
    }
  });
}

function teardownPeer() {
  if (conn) { try { conn.close(); } catch (e) {} conn = null; }
  if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
}

// ===================== Connection message handling =====================
function attachConnHandlers() {
  conn.on("open", function () {
    if (myRole === "host") {
      conn.send({ type: "init", theme: theme, board: board, hostName: myUsername });
      resetGameState();
      setTopbar();
      setupBoardUI();
      showScreen("gameBoardScreen");
    } else {
      conn.send({ type: "joinerInfo", name: myUsername });
      document.getElementById("joinStatusMsg").textContent = "Connected! Waiting for host…";
    }
  });

  conn.on("data", function (msg) { handleIncoming(msg); });

  conn.on("close", function () {
    if (activeScreen !== "lobbyScreen") {
      alert("Your opponent disconnected.");
      returnToLobby();
    }
  });
}

function handleIncoming(msg) {
  switch (msg.type) {
    case "init":
      theme = msg.theme;
      board = msg.board;
      opponentName = msg.hostName;
      mySecretIndex = Math.floor(Math.random() * 16);
      applyThemeBackground(theme);
      resetGameState();
      setTopbar();
      setupBoardUI();
      showScreen("gameBoardScreen");
      break;

    case "joinerInfo":
      opponentName = msg.name;
      break;

    case "state":
      gameState = msg.data;
      renderState();
      break;

    case "guess":
      handleIncomingGuess(msg);
      break;

    case "guessResult":
      gameState.gameOver = true;
      gameState.winner = msg.winner;
      showReveal(msg.targetSecretIndex);
      break;

    case "reset":
      board = msg.board;
      mySecretIndex = Math.floor(Math.random() * 16);
      resetGameState();
      setupBoardUI();
      showScreen("gameBoardScreen");
      break;

    case "exit":
      alert("Your opponent left the game.");
      returnToLobby();
      break;
  }
}

function resetGameState() {
  gameState = { turn: "host", needsAnswer: false, history: [], gameOver: false, winner: "" };
  selectedIndex = -1;
  hiddenSet = new Set();
}

// ===================== Board setup & rendering =====================
function setupBoardUI() {
  document.getElementById("myIdentityImg").src = board[mySecretIndex].img;
  document.getElementById("myIdentityName").textContent = board[mySecretIndex].name;
  var grid = document.getElementById("boardGrid");
  grid.innerHTML = "";
  board.forEach(function (p, i) {
    var card = document.createElement("div");
    card.className = "board-card";
    card.dataset.index = i;
    var img = document.createElement("img");
    img.src = p.img;
    img.alt = p.name;
    card.appendChild(img);
    var overlay = document.createElement("img");
    overlay.className = "hide-overlay";
    overlay.src = "images/xOut.png";
    overlay.alt = "";
    card.appendChild(overlay);
    card.addEventListener("click", function () { openCardDetail(i); });
    grid.appendChild(card);
  });
  renderState();
}

function renderState() {
  renderQuestionLog();
  updateUIForTurn();
}

function renderQuestionLog() {
  var lines = gameState.history.map(function (r) {
    var text = nameForRole(r.askerRole) + ": " + r.question;
    if (r.answerText) {
      text += "\n" + nameForRole(r.answererRole) + ": " + r.answerText;
    }
    return text;
  });
  var full = lines.join("\n\n");
  ["qAtBox", "qAtBoxAsk"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = full;
    el.scrollTop = el.scrollHeight;
  });
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function updateUIForTurn() {
  var isMyTurn = gameState.turn === myRole;
  var answerControls = document.getElementById("answerControls");
  var goToAskBtn = document.getElementById("goToAskBtn");

  answerControls.classList.add("hidden");
  goToAskBtn.classList.add("hidden");

  if (gameState.gameOver) {
    setText("turnLabel", "GAME OVER");
    refreshGuessAvailability();
    return;
  }

  if (gameState.needsAnswer) {
    if (isMyTurn) {
      setText("turnLabel", "YOU MUST ANSWER!");
      answerControls.classList.remove("hidden");
    } else {
      setText("turnLabel", "WAITING FOR ANSWER…");
    }
  } else {
    if (isMyTurn) {
      setText("turnLabel", "YOUR TURN TO ASK!");
      goToAskBtn.classList.remove("hidden");
    } else {
      setText("turnLabel", "OPPONENT'S TURN…");
    }
  }
  refreshGuessAvailability();
}

function canGuessNow() {
  return gameState.turn === myRole && !gameState.needsAnswer && !gameState.gameOver;
}

function refreshGuessAvailability() {
  if (activeScreen !== "playerEditScreen") return;
  var guessBtn = document.getElementById("guessButton");
  var hint = document.getElementById("guessHintMsg");
  if (canGuessNow()) {
    guessBtn.classList.remove("hidden");
    hint.classList.add("hidden");
  } else {
    guessBtn.classList.add("hidden");
    hint.classList.remove("hidden");
  }
}

function sendState() {
  if (conn && conn.open) conn.send({ type: "state", data: gameState });
}

// ===================== Card detail / hide =====================
function openCardDetail(i) {
  selectedIndex = i;
  document.querySelectorAll(".board-card").forEach(function (c) { c.classList.remove("selected"); });
  var cardEl = document.querySelector('.board-card[data-index="' + i + '"]');
  if (cardEl) cardEl.classList.add("selected");

  var p = board[i];
  document.getElementById("editScreenImage").src = p.img;
  document.getElementById("editScreenText").textContent = p.name;
  document.getElementById("hideButton").textContent = hiddenSet.has(i) ? "UN-HIDE" : "HIDE";
  document.getElementById("editScreenHideOverlay").classList.toggle("hidden", !hiddenSet.has(i));
  showScreen("playerEditScreen");
  refreshGuessAvailability();
}

document.getElementById("hideButton").addEventListener("click", function () {
  if (hiddenSet.has(selectedIndex)) {
    hiddenSet.delete(selectedIndex);
  } else {
    hiddenSet.add(selectedIndex);
  }
  var isHidden = hiddenSet.has(selectedIndex);
  var cardEl = document.querySelector('.board-card[data-index="' + selectedIndex + '"]');
  if (cardEl) cardEl.classList.toggle("hidden-card", isHidden);
  document.getElementById("hideButton").textContent = isHidden ? "UN-HIDE" : "HIDE";
  document.getElementById("editScreenHideOverlay").classList.toggle("hidden", !isHidden);
});

document.getElementById("backButton").addEventListener("click", function () {
  showScreen("gameBoardScreen");
});

// ===================== Ask / Answer flow =====================
document.getElementById("goToAskBtn").addEventListener("click", function () {
  renderQuestionLog();
  document.getElementById("questionEntry").value = "";
  showScreen("enterGuessScreen");
});

document.getElementById("askBackButton").addEventListener("click", function () {
  showScreen("gameBoardScreen");
});

document.getElementById("askButton").addEventListener("click", function () {
  var q = document.getElementById("questionEntry").value.trim();
  if (q === "") return;
  gameState.history.push({
    askerRole: myRole,
    question: q,
    answererRole: otherRole(myRole),
    answerText: null
  });
  gameState.turn = otherRole(myRole);
  gameState.needsAnswer = true;
  sendState();
  showScreen("gameBoardScreen");
  renderState();
});

document.getElementById("yesButton").addEventListener("click", function () { answerQuestion("YES"); });
document.getElementById("noButton").addEventListener("click", function () { answerQuestion("NO"); });

function answerQuestion(ans) {
  var last = gameState.history[gameState.history.length - 1];
  if (last) last.answerText = ans;
  gameState.needsAnswer = false;
  sendState();
  renderState();
}

// ===================== Guessing =====================
document.getElementById("guessButton").addEventListener("click", function () {
  if (selectedIndex === -1 || !canGuessNow()) return;
  conn.send({
    type: "guess",
    guesserSecretIndex: mySecretIndex,
    guessedIndex: selectedIndex,
    guesserName: myUsername
  });
});

function handleIncomingGuess(msg) {
  // Board positions match on both sides because the host's board array
  // (with fixed order) was sent to the joiner verbatim during "init".
  var correct = (msg.guessedIndex === mySecretIndex);
  var winner = correct ? otherRole(myRole) : myRole; // otherRole(myRole) is the guesser's role
  gameState.gameOver = true;
  gameState.winner = winner;

  conn.send({
    type: "guessResult",
    correct: correct,
    targetSecretIndex: mySecretIndex,
    winner: winner
  });

  showReveal(msg.guesserSecretIndex);
}

function showReveal(opponentSecretIndex) {
  var p = board[opponentSecretIndex];
  document.getElementById("revealImg").src = p.img;
  document.getElementById("revealNameLabel").textContent = "Opponent: " + p.name;

  var won = gameState.winner === myRole;
  setText("winLossLabel", won ? "VICTORY!" : "DEFEAT…");

  var playAgainBtn = document.getElementById("playAgainBtn");
  var waitingMsg = document.getElementById("waitingRematchMsg");
  if (myRole === "host") {
    playAgainBtn.classList.remove("hidden");
    waitingMsg.classList.add("hidden");
  } else {
    playAgainBtn.classList.add("hidden");
    waitingMsg.classList.remove("hidden");
  }

  showScreen("gameOverScreen");
}

// ===================== Play again / exit =====================
document.getElementById("playAgainBtn").addEventListener("click", function () {
  if (myRole !== "host") return;
  board = pickBoard(theme);
  mySecretIndex = Math.floor(Math.random() * 16);
  resetGameState();
  conn.send({ type: "reset", board: board });
  setupBoardUI();
  showScreen("gameBoardScreen");
});

function leaveGame() {
  if (conn && conn.open) conn.send({ type: "exit" });
  returnToLobby();
}
document.getElementById("homeBtn").addEventListener("click", leaveGame);
document.getElementById("homeBtn2").addEventListener("click", leaveGame);

function returnToLobby() {
  teardownPeer();
  theme = "";
  roomCode = "";
  myRole = "";
  board = [];
  mySecretIndex = -1;
  selectedIndex = -1;
  hiddenSet = new Set();

  applyThemeBackground("");
  setTopbar();

  document.getElementById("hostSetup").classList.add("hidden");
  document.getElementById("hostWaiting").classList.add("hidden");
  document.getElementById("joinSetup").classList.add("hidden");
  document.getElementById("joinStatusMsg").textContent = "";
  document.getElementById("roomCodeInput").value = "";
  document.getElementById("joinRoomBtn").disabled = false;
  document.querySelectorAll(".theme-tile").forEach(function (t) { t.classList.remove("selected"); });
  document.getElementById("createRoomBtn").disabled = true;
  document.getElementById("hostJoinRow").classList.toggle("hidden", myUsername === "");

  showScreen("lobbyScreen");
}

// ===================== Init =====================
showScreen("lobbyScreen");
