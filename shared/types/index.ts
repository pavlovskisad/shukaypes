export interface LatLng {
  lat: number;
  lng: number;
}

export type UrgencyLevel = 'urgent' | 'medium' | 'resolved';
export type TokenType = 'regular' | 'bonus' | 'gold';
export type QuestType = 'detective' | 'errand' | 'explore' | 'city';
export type SkinCategory = 'detective' | 'explorer' | 'hero' | 'social' | 'seasonal';

export interface User {
  id: string;
  username: string;
  avatarUrl?: string;
  createdAt: string;
  points: number;
  totalTokens: number;
  totalDistanceKm: number;
  homePosition?: LatLng;
}

export interface Companion {
  userId: string;
  name: string;
  level: number;
  xp: number;
  skinId: string;
  hunger: number;
  happiness: number;
  lastFedAt?: string;
  lastInteractionAt?: string;
  memoryNotes?: string;
}

export interface Token {
  id: string;
  type: TokenType;
  position: LatLng;
  value: number;
  zoneId?: string;
  spawnedAt: string;
  collectedBy?: string;
  collectedAt?: string;
}

export interface FoodItem {
  id: string;
  position: LatLng;
  value: number;
  spawnedAt: string;
}

export interface LostDog {
  id: string;
  name: string;
  breed: string;
  photoUrl?: string;
  emoji: string;
  lastSeen: {
    position: LatLng;
    at: string;
    description?: string;
  };
  urgency: UrgencyLevel;
  searchZoneRadius: number;
  rewardPoints: number;
  source: 'scrape' | 'in_app';
  status: 'active' | 'found' | 'expired';
  reportedBy?: string;
}

export interface Sighting {
  id: string;
  dogId: string;
  reporterId: string;
  position: LatLng;
  at: string;
  note?: string;
}

export interface Waypoint {
  position: LatLng;
  clue?: string;
  reached: boolean;
}

export interface Quest {
  id: string;
  type: QuestType;
  userId: string;
  dogId?: string;
  waypoints: Waypoint[];
  currentWaypoint: number;
  startedAt: string;
  completedAt?: string;
  rewardPoints: number;
  narrativeState?: string;
}

export interface PartnerSpot {
  id: string;
  name: string;
  type: string;
  position: LatLng;
  partnerId?: string;
  discountType?: string;
  discountValue?: number;
}

export interface WalkerSession {
  userId: string;
  position: LatLng;
  skinId: string;
  companionName: string;
  lastPingAt: string;
}

export type ChatRole = 'user' | 'assistant';
export type ChatMode = 'active' | 'ambient';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  mode: ChatMode;
  createdAt: string;
}
