# Unified Real-time Communication Pattern

## Overview

This pattern provides a **common interface** for SSE and Socket.IO that abstracts away the differences while leveraging Socket.IO's bidirectional capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              UnifiedRealtimeProvider Interface              │
│  ┌──────────────────┐         ┌──────────────────┐      │
│  │  SSE Provider    │         │ Socket.IO Provider │      │
│  │  (Unidirectional)│         │  (Bidirectional)   │      │
│  └──────────────────┘         └──────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Common Broadcast Patterns

Both SSE and Socket.IO support:

### 1. **Push to User**
```typescript
const provider = notificationService.getRealtimeProvider('socket');
provider.getBroadcast().toUser(userId, 'notification', { subject: 'Hello', body: 'World' });
```

### 2. **Push to Tenant**
```typescript
provider.getBroadcast().toTenant(tenantId, 'announcement', { message: 'System maintenance' });
```

### 3. **Push to All**
```typescript
provider.getBroadcast().toAll('system:alert', { level: 'critical', message: 'Server restart' });
```

### 4. **Push to Room** (Socket.IO only, SSE falls back to toAll)
```typescript
provider.getBroadcast().toRoom('support-chat', 'message', { from: 'admin', text: 'Hello' });
```

## Socket.IO Specific Features

Socket.IO supports bidirectional communication:

### 1. **Request with Acknowledgment**
```typescript
const socketProvider = notificationService.getRealtimeProvider('socket');
const features = socketProvider.getSocketIOFeatures();

features.toUserWithAck(userId, 'request:status', { action: 'check' }, (response) => {
  console.log('User responded:', response);
});
```

### 2. **Room Management**
```typescript
// Join user to a room
features.joinRoom(userId, 'support-chat');

// Remove user from room
features.leaveRoom(userId, 'support-chat');

// Get user's rooms
const rooms = features.getUserRooms(userId);
```

## Usage Examples

### Example 1: Send Notification to User
```typescript
// Works for both SSE and Socket.IO
notificationService.broadcastToUser('socket', userId, 'notification', {
  subject: 'New message',
  body: 'You have a new message',
  channel: 'SOCKET'
});
```

### Example 2: Broadcast to All Users in Tenant
```typescript
notificationService.broadcastToTenant('sse', tenantId, 'announcement', {
  title: 'System Update',
  message: 'Scheduled maintenance at 2 AM'
});
```

### Example 3: Socket.IO Room-based Chat
```typescript
// Join users to room
const socketProvider = notificationService.getRealtimeProvider('socket');
socketProvider.getSocketIOFeatures()?.joinRoom(userId1, 'chat-room');
socketProvider.getSocketIOFeatures()?.joinRoom(userId2, 'chat-room');

// Broadcast to room
notificationService.broadcastToRoom('chat-room', 'message', {
  from: 'admin',
  text: 'Welcome to the chat!'
});
```

### Example 4: Check Provider Capabilities
```typescript
const provider = notificationService.getRealtimeProvider('socket');

if (provider.isBidirectional()) {
  // Use Socket.IO specific features
  provider.getSocketIOFeatures()?.toUserWithAck(userId, 'ping', {}, (response) => {
    console.log('Pong received:', response);
  });
} else {
  // SSE - unidirectional only
  provider.getBroadcast().toUser(userId, 'notification', data);
}
```

## Benefits

1. **Unified API**: Same interface for SSE and Socket.IO
2. **Type Safety**: TypeScript interfaces ensure correct usage
3. **Flexibility**: Choose the right channel based on needs
4. **Extensibility**: Socket.IO features available when needed
5. **Easy Testing**: Mock the interface for testing

## When to Use SSE vs Socket.IO

### Use SSE when:
- ✅ Unidirectional communication (server → client)
- ✅ Simple event streaming
- ✅ Lower overhead needed
- ✅ Browser EventSource API is sufficient

### Use Socket.IO when:
- ✅ Bidirectional communication needed
- ✅ Real-time chat/messaging
- ✅ Room-based broadcasting
- ✅ Need acknowledgments/confirmation
- ✅ More advanced features required

## Implementation Details

### SSE Provider
- Implements `RealtimeBroadcast` interface
- `toRoom()` falls back to `toAll()` (SSE doesn't support rooms)
- Unidirectional only

### Socket.IO Provider
- Implements `SocketIOBroadcast` (extends `RealtimeBroadcast`)
- Full bidirectional support
- Room management
- Acknowledgment support
