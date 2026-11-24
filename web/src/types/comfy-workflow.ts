export type WorkflowValue = string | number | boolean;
export type WorkflowValues = Record<string, Record<string, WorkflowValue>>;

export type ComfyWorkflowContract = {
    fields: Array<{
        key: string;
        from: string;
        required?: boolean;
        media?: string;
        frameRole?: "firstFrame" | "lastFrame";
        array?: boolean;
        imageIndex?: number;
        videoIndex?: number;
        min?: number;
        max?: number;
        type: string;
        default?: WorkflowValue;
        transform?: string;
    }>;
    outputNodes: string[];
    asyncImages?: boolean;
};
