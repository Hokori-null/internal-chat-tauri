const wsUrl = 'wss://ic.honulla.com/ws';

var users = [];
var me = new XChatUser();

function setRemote() {
  me.setRemoteSdp(remoteSDP.value);
}
function addLinkItem(uid, file) {
  const chatBox = document.querySelector('.chat-wrapper');
  const chatItem = document.createElement('div');
  chatItem.className = 'chat-item';
  chatItem.innerHTML = `
    <div class="chat-item_user">${uid === me.id ? '（我）': ''}${uid} :</div>
    <div class="chat-item_content"><a class="file" href="${file.url}" download="${file.name}">[文件] ${file.name}</a></div>
  `;
  chatBox.appendChild(chatItem);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function addChatItem(uid, message) {
  const chatBox = document.querySelector('.chat-wrapper');
  const chatItem = document.createElement('div');
  chatItem.className = 'chat-item';
  let msg = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 判断是否url，兼容端口号的网址,http://127.0.0.1:8080/
  if (/(http|https):\/\/[a-zA-Z0-9\.\-\/\?=\:_]+/g.test(msg)) {
    msg = msg.replace(/(http|https):\/\/[a-zA-Z0-9\.\-\/\?=\:_]+/g, (url) => {
      return `<a href="${url}" target="_blank">${url}</a>`;
    });
  }

  chatItem.innerHTML = `
    <div class="chat-item_user">${uid === me.id ? '（我）': ''}${uid} :</div>
    <div class="chat-item_content"><pre>${msg}</pre></div>
  `;
  chatBox.appendChild(chatItem);
  chatBox.scrollTop = chatBox.scrollHeight;

}
function sendMessage(msg) {
  const message = msg ?? messageInput.value;
  addChatItem(me.id, message);
  users.forEach(u => {
    if (u.isMe) {
      return;
    }
    u.sendMessage(message);
  });
  messageInput.value = '';
}

async function sendFile(file) {
  pendingFile = file;

  const otherUsers = users.filter(u => !u.isMe);

  // 检查是否有其他用户在线
  if (otherUsers.length === 0) {
    alert('没有其他用户在线，无法发送文件。');
    pendingFile = null;
    return;
  }

  // 如果只有一个用户在线，直接发送文件
  if (otherUsers.length === 1) {
    const modal = document.getElementById('userSelectModal');
    const progressContainer = modal.querySelector('.progress-container');
    const progressBar = modal.querySelector('.progress-bar-inner');
    const progressText = modal.querySelector('.progress-text');

    try {
      const user = otherUsers[0];
      const fileInfo = { name: file.name, size: file.size };

      // 显示进度条
      modal.style.display = 'block';
      document.getElementById('userSelectList').style.display = 'none';
      modal.querySelector('.modal-footer').style.display = 'none';
      progressContainer.style.display = 'block';
      progressText.textContent = `正在发送给 ${user.id}...`;

      // 创建进度回调
      const onProgress = (sent, total) => {
        const progress = (sent / total) * 100;
        progressBar.style.width = progress + '%';
      };

      await user.sendFile(fileInfo, file, onProgress);
      addChatItem(me.id, `[文件] ${fileInfo.name} (发送给: ${user.id})`);
    } catch (error) {
      console.error('发送文件失败:', error);
      alert('发送文件失败，请重试');
    } finally {
      // 恢复界面状态
      modal.style.display = 'none';
      document.getElementById('userSelectList').style.display = 'block';
      modal.querySelector('.modal-footer').style.display = 'block';
      progressContainer.style.display = 'none';
      progressBar.style.width = '0%';
    }

    pendingFile = null;
    return;
  }

  // 多用户情况下显示选择用户的弹窗
  showUserSelectModal();
}
function registCandidate() {
  for (const ca of JSON.parse(candidate.value)) {
    me.addIceCandidate(ca);
  }
}


function connectAllOther() {
  if (users.length <= 1) {
    return;
  }
  const targets = users.filter(u => u.id !== me.id);
  for (const target of targets) {
    target.onicecandidate = (candidate) => {
      // console.log('candidate', candidate);
      signalingServer.send(JSON.stringify({uid: me.id, targetId: target.id, type: '9001', data: { candidate }}));
    }
    target.createConnection().then(() => {
      // console.log('targetAddr', target.connAddressMe);
      signalingServer.send(JSON.stringify({uid: me.id, targetId: target.id, type: '9002', data: { targetAddr: target.connAddressMe }}));
    })
  }
}


function refreshUsers(data) {
  resUsers = data.map(
    u => {
      let uOld = users.find(uOld => uOld.id === u.id)
      if (uOld) {
        return uOld;
      }
      let xchatUser = new XChatUser();
      xchatUser.id = u.id;
      xchatUser.isMe = u.id === me.id;
      return xchatUser;
    }
  );

  // 找出删除的用户
  const delUsers = users.filter(u => !resUsers.find(u2 => u2.id === u.id));
  delUsers.forEach(u => {
    u.closeConnection();
  });

  users = resUsers;
  for (const u of users) {
    u.onmessage = (msg) => {
      addChatItem(u.id, msg);
    }
    u.onReviceFile = (file) => {
      addLinkItem(u.id, file);
    }
  }
  refreshUsersHTML();
}

function joinedRoom() {
  connectAllOther();
}

function addCandidate(data) {
  users.find(u => u.id === data.targetId).addIceCandidate(data.candidate);
}
async function joinConnection(data) {
  const user = users.find(u => u.id === data.targetId)
  if (!user) {
    return;
  }
  user.onicecandidate = (candidate) => {
    // console.log('candidate', candidate);
    signalingServer.send(JSON.stringify({uid: me.id, targetId: user.id, type: '9001', data: { candidate }}));
  }
  await user.connectTarget(data.offer.sdp)
  signalingServer.send(JSON.stringify({uid: me.id, targetId: user.id, type: '9003', data: { targetAddr: user.connAddressMe }}));
}

async function joinedConnection(data) {
  const target = users.find(u => u.id === data.targetId)
  if (!target) {
    return;
  }
  await target.setRemoteSdp(data.answer.sdp);
}

function refreshUsersHTML() {
  document.querySelector('#users').innerHTML = users.map(u => `<li>${u.id}${u.isMe?'（我）':''}</li>`).join('');
}

function enterTxt(event) {
  if (event.ctrlKey || event.shiftKey) {
    return;
  }
  if (event.keyCode === 13) {
    sendMessage();
    event.preventDefault();
  }
}

// 连接信令服务器
const signalingServer = new WebSocket(wsUrl);
signalingServer.onopen = () => {
  console.log('Connected to signaling server');
  setInterval(() => {
    signalingServer.send(JSON.stringify({type: '9999'}));
  }, 1000 * 10);
}
signalingServer.onmessage = ({ data: responseStr }) => {
  const response = JSON.parse(responseStr);
  const { type, data } = response;

  if (type === '1001') {
    me.id = data.id;

    // 设置 titlebar-title 显示 uid
    const titlebarTitle = document.getElementById('titlebar-title');
    if (titlebarTitle) {
      titlebarTitle.textContent = `当前用户：${me.id}`;
    }
    return;
  }

  if (type === '1002') {
    refreshUsers(data);
    return;
  }

  if (type === '1003') {
    joinedRoom();
    return;
  }

  if (type === '1004') {
    addCandidate(data);
    return;
  }

  if (type === '1005') {
    joinConnection(data);
    return;
  }

  if (type === '1006') {
    joinedConnection(data);
    return;
  }
}

function showUserSelectModal() {
  const modal = document.getElementById('userSelectModal');
  const userList = document.getElementById('userSelectList');
  
  // 清空之前的列表
  userList.innerHTML = '';
  
  // 添加用户选项
  users.forEach(user => {
    if (!user.isMe) {
      const item = document.createElement('div');
      item.className = 'user-select-item';
      const id = `user-${user.id}`;
      
      // 不使用 label 的 for 属性，改用包裹的方式
      item.innerHTML = `
        <label>
          <input type="checkbox" value="${user.id}">
          <span>${user.id}</span>
        </label>
      `;
      
      // 点击整行时切换复选框状态
      item.addEventListener('click', (e) => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        // 如果点击的是复选框本身，不需要额外处理
        if (e.target === checkbox) return;
        
        checkbox.checked = !checkbox.checked;
        e.preventDefault(); // 阻止事件冒泡
      });
      
      userList.appendChild(item);
    }
  });
  
  modal.style.display = 'block';
}

function cancelSendFile() {
  const modal = document.getElementById('userSelectModal');
  modal.style.display = 'none';
  pendingFile = null;
}

async function confirmSendFile() {
  const modal = document.getElementById('userSelectModal');
  const sendButton = modal.querySelector('.modal-footer button:last-child');
  const progressContainer = modal.querySelector('.progress-container');
  const progressBar = modal.querySelector('.progress-bar-inner');
  const progressText = modal.querySelector('.progress-text');
  const userList = document.getElementById('userSelectList');
  const selectedUsers = Array.from(document.querySelectorAll('#userSelectList input[type="checkbox"]:checked'))
    .map(checkbox => users.find(u => u.id === checkbox.value));
  
  if (selectedUsers.length > 0 && pendingFile) {
    // 禁用发送按钮并显示进度条
    sendButton.disabled = true;
    sendButton.textContent = '发送中...';
    userList.style.display = 'none';
    progressContainer.style.display = 'block';
    
    try {
      const fileInfo = { name: pendingFile.name, size: pendingFile.size };
      const totalUsers = selectedUsers.length;
      
      for (let i = 0; i < selectedUsers.length; i++) {
        const user = selectedUsers[i];
        progressText.textContent = `正在发送给 ${user.id}... (${i + 1}/${totalUsers})`;
        
        // 创建进度回调
        const onProgress = (sent, total) => {
          const userProgress = (sent / total) * 100;
          const totalProgress = ((i * 100) + userProgress) / totalUsers;
          progressBar.style.width = totalProgress + '%';
        };
        
        await user.sendFile(fileInfo, pendingFile, onProgress);
      }
      
      addChatItem(me.id, `[文件] ${fileInfo.name} (发送给: ${selectedUsers.map(u => u.id).join(', ')})`);
    } catch (error) {
      console.error('发送文件失败:', error);
      alert('发送文件失败，请重试');
    } finally {
      // 恢复界面状态
      sendButton.disabled = false;
      sendButton.textContent = '发送';
      userList.style.display = 'block';
      progressContainer.style.display = 'none';
      progressBar.style.width = '0%';
    }
  }
  
  modal.style.display = 'none';
  pendingFile = null;
}
