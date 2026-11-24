import type { ModelRoleConfig, ModelRoleSetting, RoleName } from "../../domain/provider.ts";

/**
 * P4-2：角色模型配置端口（v2.1 §5.1.5：Assistant/Reviewer 独立 provider/model/credential）。
 * 设置页同时启用两个角色；会话保留创建时的助手绑定。
 */
export interface RoleConfigStore {
  get(role: RoleName): ModelRoleSetting | null;
  set(role: RoleName, setting: ModelRoleSetting): void;
  activate(settings: ModelRoleConfig): void;
  isAuthorized(role: RoleName, providerId: string): boolean;
}

export class InMemoryRoleConfigStore implements RoleConfigStore {
  private readonly map = new Map<RoleName, ModelRoleSetting>();
  private readonly authorized = { assistant: new Set<string>(), reviewer: new Set<string>() };

  get(role: RoleName): ModelRoleSetting | null {
    const s = this.map.get(role);
    return s ? { ...s } : null;
  }

  set(role: RoleName, setting: ModelRoleSetting): void {
    this.map.set(role, { ...setting });
  }

  activate(settings: ModelRoleConfig): void {
    for (const role of ["assistant", "reviewer"] as const) {
      const previous = this.get(role);
      if (previous) this.authorized[role].add(previous.providerId);
      this.authorized[role].add(settings[role].providerId);
      this.set(role, settings[role]);
    }
  }

  isAuthorized(role: RoleName, providerId: string): boolean {
    return this.get(role)?.providerId === providerId || this.authorized[role].has(providerId);
  }
}
