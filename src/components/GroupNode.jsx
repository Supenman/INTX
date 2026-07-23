import { memo, useState, useCallback, useRef, useEffect } from 'react';

function GroupNode({ data, selected, id }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data?.title || '组');
  const inputRef = useRef(null);

  const startEditing = useCallback((e) => {
    e.stopPropagation();
    setEditing(true);
  }, []);

  const commitTitle = useCallback((val) => {
    setEditing(false);
    if (data?.onTitleChange && val !== data.title) {
      data.onTitleChange(id, val);
    }
  }, [data, id]);

  const handleBlur = useCallback(() => {
    commitTitle(title);
  }, [commitTitle, title]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setTitle(data?.title || '组');
      setEditing(false);
    }
  }, [data]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    setTitle(data?.title || '组');
  }, [data?.title]);

  return (
    <div
      className={`group-node${selected ? ' selected' : ''}`}
      style={data?.bgColor ? { backgroundColor: data.bgColor } : undefined}
    >
      <div className="group-node-title" onClick={editing ? undefined : startEditing}>
        {editing ? (
          <input
            ref={inputRef}
            className="group-node-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="group-node-title-text">{title}</span>
        )}
      </div>
    </div>
  );
}

export default memo(GroupNode);
