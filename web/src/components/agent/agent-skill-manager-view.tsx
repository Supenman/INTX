import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, App, Button, Input, Modal, Spin } from "antd";
import { FileUp, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { canvasThemes } from "@/lib/canvas-theme";
import { AgentApiError, createOpencodeSkill, deleteOpencodeSkill, fetchOpencodeSkill, updateOpencodeSkill, type AgentSkillDetail, type AgentSkillInput } from "@/services/api/canvas-agent";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";

type SkillDraft = { name: string; description: string; instructions: string; displayName: string; shortDescription: string; defaultPrompt: string; revision: string };

const emptyDraft = (): SkillDraft => ({ name: "", description: "", instructions: "", displayName: "", shortDescription: "", defaultPrompt: "", revision: "" });

export function AgentSkillManagerView({ theme, endpoint, token, connected, fullPage = false }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; endpoint: string; token: string; connected: boolean; fullPage?: boolean }) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const { skills, loading, errors, loadSkills } = useAgentSkillStore(useShallow((state) => ({ skills: state.skills, loading: state.loading, errors: state.errors, loadSkills: state.loadSkills })));
    const [editing, setEditing] = useState<SkillDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [opening, setOpening] = useState("");
    const [revisionConflict, setRevisionConflict] = useState(false);
    const [keyword, setKeyword] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const visibleSkills = useMemo(() => {
        const query = keyword.trim().toLocaleLowerCase();
        return skills.filter((skill) => !query || `${skill.name}\n${skill.interface?.displayName || ""}\n${skill.description}`.toLocaleLowerCase().includes(query));
    }, [keyword, skills]);

    useEffect(() => {
        if (connected) void loadSkills(endpoint, token, true);
    }, [connected, endpoint, token, loadSkills]);

    const refresh = () => void loadSkills(endpoint, token, true);
    const importFile = async (file: File) => {
        try {
            if (file.size > 256 * 1024) throw new Error(t("agent.skillManager.importTooLarge"));
            const draft = await readSkillMarkdown(file);
            setRevisionConflict(false);
            setEditing(draft);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.skillManager.importFailed"));
        }
    };
    const openSkill = async (name: string) => {
        setOpening(name);
        try {
            const result = await fetchOpencodeSkill(endpoint, token, name);
            if (!result.data) throw new Error(t("agent.skillManager.loadFailed"));
            setEditing(toDraft(result.data));
            setRevisionConflict(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.skillManager.loadFailed"));
        } finally {
            setOpening("");
        }
    };
    const save = async () => {
        if (!editing) return;
        const input: AgentSkillInput = {
            ...(editing.revision ? {} : { name: editing.name.trim() }),
            description: editing.description.trim(),
            instructions: editing.instructions,
            interface: {
                ...(editing.displayName.trim() ? { displayName: editing.displayName.trim() } : {}),
                ...(editing.shortDescription.trim() ? { shortDescription: editing.shortDescription.trim() } : {}),
                ...(editing.defaultPrompt.trim() ? { defaultPrompt: editing.defaultPrompt.trim() } : {}),
            },
            ...(editing.revision ? { expectedRevision: editing.revision } : {}),
        };
        setSaving(true);
        try {
            const result = editing.revision
                ? await updateOpencodeSkill(endpoint, token, editing.name, input)
                : await createOpencodeSkill(endpoint, token, input);
            await loadSkills(endpoint, token, true);
            setEditing(result.data ? toDraft(result.data) : null);
            message.success(t("agent.skillManager.saved"));
        } catch (error) {
            if (error instanceof AgentApiError && error.status === 409) setRevisionConflict(true);
            message.error(error instanceof Error ? error.message : t("agent.skillManager.saveFailed"));
        } finally {
            setSaving(false);
        }
    };
    const confirmDelete = (name: string, revision: string) => modal.confirm({
        title: t("agent.skillManager.deleteTitle", { name }),
        content: t("agent.skillManager.deleteDescription"),
        okText: t("common.delete"),
        okType: "danger",
        cancelText: t("common.cancel"),
        onOk: async () => {
            try {
                await deleteOpencodeSkill(endpoint, token, name, revision);
                if (editing?.name === name) setEditing(null);
                await loadSkills(endpoint, token, true);
                message.success(t("agent.skillManager.deleted"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("agent.skillManager.deleteFailed"));
                throw error;
            }
        },
    });

    return (
        <div className={`thin-scrollbar min-h-0 flex-1 overflow-y-auto ${fullPage ? "pt-5" : "p-3"}`}>
            {!connected ? <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>{t("agent.skillManager.connectHint")}</div> : (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        {fullPage ? <Input allowClear prefix={<Search className="size-4" />} className="max-w-xl" placeholder={t("agent.skillManager.search")} value={keyword} onChange={(event) => setKeyword(event.target.value)} /> : <div className="text-sm" style={{ color: theme.node.muted }}>{t("agent.skillManager.description", { count: skills.length })}</div>}
                        <div className="flex gap-2">
                            <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={loading} onClick={refresh}>{t("agent.skillManager.refresh")}</Button>
                            {fullPage ? <Button size="small" icon={<FileUp className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>{t("agent.skillManager.import")}</Button> : null}
                            <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={loading} onClick={() => { setRevisionConflict(false); setEditing(emptyDraft()); }}>{t("agent.skillManager.create")}</Button>
                        </div>
                    </div>
                    {fullPage ? <div className="text-xs" style={{ color: theme.node.muted }}>{t("agent.skillManager.description", { count: skills.length })}</div> : null}
                    {fullPage ? <input ref={fileInputRef} className="hidden" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} /> : null}
                    {errors.length ? <div className="text-xs text-amber-500">{errors.join(" · ")}</div> : null}
                    {loading && !skills.length ? <div className="py-10 text-center"><Spin /></div> : visibleSkills.length ? (
                        <div className="divide-y rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                            {visibleSkills.map((skill) => <div key={skill.name} className="flex items-center gap-2 px-3 py-3 hover:bg-[var(--surface-card-hover)] focus-within:bg-[var(--surface-card-hover)] motion-safe:transition-colors" style={{ borderColor: theme.node.stroke }}>
                                <button type="button" className="focus-ring min-w-0 flex-1 rounded-sm text-left disabled:cursor-wait" disabled={Boolean(opening)} onClick={() => void openSkill(skill.name)}>
                                    <div className="truncate text-sm font-medium" style={{ color: theme.node.text }}>{skill.interface?.displayName || skill.name}</div>
                                    <div className="line-clamp-2 text-xs" style={{ color: theme.node.muted }}>{skill.description}</div>
                                </button>
                                {opening === skill.name ? <Spin size="small" /> : <Button size="small" type="text" icon={<Pencil className="size-3.5" />} aria-label={t("agent.skillManager.edit", { name: skill.name })} onClick={() => void openSkill(skill.name)} />}
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} aria-label={t("agent.skillManager.delete", { name: skill.name })} onClick={() => confirmDelete(skill.name, skill.revision)} />
                            </div>)}
                        </div>
                    ) : <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>{skills.length ? t("agent.skillManager.noMatch") : t("agent.skillManager.empty")}</div>}
                </div>
            )}
            <Modal
                title={editing?.revision ? t("agent.skillManager.editTitle") : t("agent.skillManager.createTitle")}
                open={Boolean(editing)}
                okText={t("common.save")}
                cancelText={t("common.cancel")}
                confirmLoading={saving}
                okButtonProps={{ disabled: !editing?.name.trim() || !editing.description.trim() || !editing.instructions.trim() }}
                onOk={() => void save()}
                onCancel={() => { setEditing(null); setRevisionConflict(false); }}
                destroyOnHidden
            >
                {editing ? <div className="space-y-3">
                    {revisionConflict ? <Alert type="warning" showIcon message={t("agent.skillManager.revisionConflict")} action={<Button size="small" onClick={() => void openSkill(editing.name)}>{t("agent.skillManager.reload")}</Button>} /> : null}
                    <Field label={t("agent.skillManager.name")}><Input value={editing.name} disabled={Boolean(editing.revision)} maxLength={64} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
                    <Field label={t("agent.skillManager.displayName")}><Input value={editing.displayName} maxLength={64} onChange={(event) => setEditing({ ...editing, displayName: event.target.value })} /></Field>
                    <Field label={t("agent.skillManager.descriptionLabel")}><Input value={editing.description} maxLength={1024} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></Field>
                    <Field label={t("agent.skillManager.shortDescription")}><Input value={editing.shortDescription} maxLength={64} onChange={(event) => setEditing({ ...editing, shortDescription: event.target.value })} /></Field>
                    <Field label={t("agent.skillManager.defaultPrompt")}><Input value={editing.defaultPrompt} maxLength={1024} onChange={(event) => setEditing({ ...editing, defaultPrompt: event.target.value })} /></Field>
                    <Field label={t("agent.skillManager.instructions")}><Input.TextArea value={editing.instructions} autoSize={{ minRows: 8, maxRows: 16 }} onChange={(event) => setEditing({ ...editing, instructions: event.target.value })} /></Field>
                </div> : null}
            </Modal>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="block space-y-1 text-xs"><span>{label}</span>{children}</label>;
}

function toDraft(skill: AgentSkillDetail): SkillDraft {
    return { name: skill.name, description: skill.description, instructions: skill.instructions, displayName: skill.interface?.displayName || "", shortDescription: skill.interface?.shortDescription || "", defaultPrompt: skill.interface?.defaultPrompt || "", revision: skill.revision };
}

async function readSkillMarkdown(file: File): Promise<SkillDraft> {
    const content = (await file.text()).replace(/^\uFEFF/, "");
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const metadata = frontmatter?.[1] || "";
    const scalar = (key: string) => {
        const match = metadata.match(new RegExp(`^${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\r\\n#]+))\\s*(?:#.*)?$`, "m"));
        return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
    };
    const body = (frontmatter?.[2] || content).trim();
    const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const fileName = file.name.replace(/\.(?:md|markdown)$/i, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/g, "");
    return { name: scalar("name") || fileName || "imported-skill", description: scalar("description") || firstHeading || file.name, instructions: body, displayName: firstHeading, shortDescription: "", defaultPrompt: "", revision: "" };
}
