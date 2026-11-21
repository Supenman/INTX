import { useNavigate, useParams as useRouterParams, useLocation } from "react-router-dom";

export function useRouter() {
    const navigate = useNavigate();
    return {
        push: (path: string) => navigate(path === "/projects" ? "/canvas" : path),
        replace: (path: string) => navigate(path === "/projects" ? "/canvas" : path, { replace: true }),
        back: () => navigate(-1),
        refresh: () => window.location.reload(),
    };
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
    return useRouterParams() as T;
}

export function usePathname() {
    return useLocation().pathname;
}
