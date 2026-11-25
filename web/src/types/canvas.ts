export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasColorGrade = "original" | "warm" | "cool" | "monochrome" | "vivid" | "faded";

export type CanvasNodeImage = {
    id: string;
    outputNodeId?: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    workflowValues?: import("./comfy-workflow").WorkflowValues;
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    /** 失败这单被判「需先确认」（可能已收单）：不给重试入口，避免点一下再扣一次钱。 */
    retryBlocked?: boolean;
    /** 锁定后仍可选中、可打开面板，但不参与拖动和缩放。 */
    locked?: boolean;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    /** 发起这次生成的节点 ID，重试时据此还原模型/尺寸与上游参考。 */
    retrySourceId?: string;
    /** 用户在提示词面板里输入的原始提示词（未拼接上游内容），重试时原样重新组装。 */
    inputPrompt?: string;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    /** 版本族根 ID；快照和当前版本都指向同一个稳定 ID。 */
    versionOfNodeId?: string;
    /** 版本族内的展示标签，A 为最初版本。 */
    versionLabel?: string;
    /** 当前版本族中被设为主版本的节点。 */
    versionPrimary?: boolean;
    timelineOrder?: number;
    timelineStartSeconds?: number;
    timelineTrimStartSeconds?: number;
    timelineTrimEndSeconds?: number;
    colorGrade?: CanvasColorGrade;
    imageTaskId?: string;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "gemini" | "runninghub";
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    strategy: "replace" | "add" | "subtract" | "toggle";
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "canvas";
          x: number;
          y: number;
          position: Position;
      }
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
