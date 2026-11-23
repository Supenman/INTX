export type WorkflowValue = string | number | boolean;
export type WorkflowValues = Record<string, Record<string, WorkflowValue>>;

export type ComfyWorkflowContract = {
    fields: Array<{
        key: string;
        from: string;
        required?: boolean;
        media?: string;
        array?: boolean;
        imageIndex?: number;
        min?: number;
        max?: number;
        type: string;
        default?: WorkflowValue;
        transform?: string;
    }>;
    outputNodes: string[];
};
