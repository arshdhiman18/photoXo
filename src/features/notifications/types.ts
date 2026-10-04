import type { NotificationType } from "@/lib/domain/notifications";

/**
 * What any viewer receives about one of THEIR notifications. Title and
 * message were rendered for the recipient's audience at creation (client
 * copy never contains internal data); the link is derived server-side.
 */
export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  href: string;
  reminder: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationSummaryDTO {
  unread: number;
  recent: NotificationDTO[];
}

export interface NotificationInboxDTO {
  items: NotificationDTO[];
  page: number;
  hasMore: boolean;
  unread: number;
}
