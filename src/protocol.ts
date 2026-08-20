export type BridgeRequestKind = 'generate_image' | 'get_task_status' | 'download_image'

export interface GenerateImageRequest {
  prompt: string
  referenceImages?: ReferenceImage[]
}

export interface ReferenceImage {
  name: string
  mimeType: string
  base64: string
}

export interface GetTaskStatusRequest {
  taskId: string
}

export interface DownloadImageRequest {
  taskId: string
  outputPath: string
  imageIndex?: number
}

export type BridgeRequestPayload = GenerateImageRequest | GetTaskStatusRequest | DownloadImageRequest

export interface BridgeJob {
  id: string
  kind: BridgeRequestKind
  payload: BridgeRequestPayload
  createdAt: number
  claimToken?: string
  heartbeatIntervalMs?: number
}

export interface BridgeResult {
  ok: boolean
  taskId?: string
  status?: string
  outputImageIds?: string[]
  imageCount?: number
  referenceImageCount?: number
  image?: {
    base64: string
    mimeType: string
  }
  path?: string
  bytes?: number
  mimeType?: string
  error?: string
}

export interface BridgeTaskStatus {
  taskId: string
  status: 'queued' | 'running' | 'done' | 'error'
  outputImageIds: string[]
  error?: string
  createdAt: number
  updatedAt: number
}

export interface BridgeHealth {
  ok: boolean
  bridge: 'running'
  extensionConnected: boolean
  extensionLastSeen: number | null
  playgroundTabCount: number
  queueLength: number
  activeJobs: number
  pendingJobs: number
  activeJob?: {
    id: string
    kind: BridgeRequestKind
    claimedAt: number
    lastHeartbeatAt: number
    heartbeatAgeMs: number
    callerTimedOut: boolean
    stale: boolean
  }
}
