"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Send, Loader2, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChat, type ChatMessage } from "@/lib/hooks/use-chat";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

interface CollaboratorChatProps {
  projectId: string;
}

export function CollaboratorChat({ projectId }: CollaboratorChatProps) {
  const { data: session } = useSession();
  const { t, locale } = useTranslations("chat");
  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track whether we're at the bottom and the unread message count
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMessagesLengthRef = useRef(0);
  const isInitialLoadRef = useRef(true);

  const {
    messages,
    isLoading,
    isSending,
    sendMessage,
    loadMore,
    hasMore,
  } = useChat({ projectId });

  // Check whether we're at the bottom (allow 50px tolerance)
  const checkIfAtBottom = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return true;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback((smooth = false) => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
      });
      setUnreadCount(0);
      setIsAtBottom(true);
    }
  }, []);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);

    // If scrolled to bottom, clear unread count
    if (atBottom) {
      setUnreadCount(0);
    }
  }, [checkIfAtBottom]);

  // Scroll to bottom after initial load completes
  useEffect(() => {
    if (!isLoading && messages.length > 0 && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      // Use setTimeout to ensure DOM has updated
      setTimeout(() => scrollToBottom(false), 0);
    }
  }, [isLoading, messages.length, scrollToBottom]);

  // Handle new messages
  useEffect(() => {
    const prevLength = prevMessagesLengthRef.current;
    const currentLength = messages.length;

    // Skip initial load
    if (prevLength === 0 && currentLength > 0) {
      prevMessagesLengthRef.current = currentLength;
      return;
    }

    // New messages arrived
    if (currentLength > prevLength) {
      const newMessagesCount = currentLength - prevLength;

      if (isAtBottom) {
        // If at bottom, auto-scroll to the latest message
        setTimeout(() => scrollToBottom(false), 0);
      } else {
        // If not at bottom, check whether the new messages include one sent by self
        const newMessages = messages.slice(prevLength);
        const hasOwnMessage = newMessages.some(
          msg => msg.user.id === session?.user?.id
        );

        if (hasOwnMessage) {
          // Own message: scroll to bottom
          setTimeout(() => scrollToBottom(true), 0);
        } else {
          // Someone else's message: increment unread count
          setUnreadCount(prev => prev + newMessagesCount);
        }
      }
    }

    prevMessagesLengthRef.current = currentLength;
  }, [messages, isAtBottom, scrollToBottom, session?.user?.id]);

  // Attach scroll event listener
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  // Send message
  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;

    const content = inputValue.trim();
    setInputValue("");
    await sendMessage(content);
    inputRef.current?.focus();
  };

  // Send on Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Check isComposing to avoid sending while IME composition is active
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString(dateLocale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Get display name for a user
  const getUserDisplayName = (user: ChatMessage["user"]) => {
    return user.name || user.email?.split("@")[0] || t("unknownUser");
  };

  // Get user's avatar initial
  const getUserInitial = (user: ChatMessage["user"]) => {
    const name = getUserDisplayName(user);
    return name.charAt(0).toUpperCase();
  };

  // Check whether a message is from the current user
  const isOwnMessage = (msg: ChatMessage) => {
    return msg.user.id === session?.user?.id;
  };

  return (
    <div className="flex h-full flex-col relative">
      {/* Message list */}
      <div className="flex-1 overflow-hidden relative" ref={scrollRef}>
        <div
          ref={scrollViewportRef}
          className="h-full overflow-y-auto p-3"
        >
        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMore}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("loadMore")
              )}
            </Button>
          </div>
        )}

        {/* Message list */}
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <p className="text-sm">{t("noMessages")}</p>
            <p className="text-xs mt-1">{t("startChat")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2",
                  isOwnMessage(msg) && "flex-row-reverse"
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white",
                    isOwnMessage(msg) ? "bg-primary" : "bg-muted-foreground"
                  )}
                  style={
                    msg.user.image
                      ? { backgroundImage: `url(${msg.user.image})`, backgroundSize: "cover" }
                      : undefined
                  }
                >
                  {!msg.user.image && getUserInitial(msg.user)}
                </div>

                {/* Message content */}
                <div
                  className={cn(
                    "max-w-[75%] space-y-1",
                    isOwnMessage(msg) && "text-right"
                  )}
                >
                  {/* Username and time */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {!isOwnMessage(msg) && (
                      <span className="font-medium">
                        {getUserDisplayName(msg.user)}
                      </span>
                    )}
                    <span>{formatTime(msg.createdAt)}</span>
                  </div>

                  {/* Message bubble */}
                  <div
                    className={cn(
                      "inline-block rounded-lg px-3 py-2 text-sm",
                      isOwnMessage(msg)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>

        {/* Jump to latest button */}
        {(!isAtBottom || unreadCount > 0) && messages.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              "absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg",
              "flex items-center gap-1.5 px-3 py-1.5",
              "bg-background/95 backdrop-blur-sm border border-border",
              "hover:bg-accent transition-all duration-200",
              "animate-in fade-in slide-in-from-bottom-2"
            )}
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="text-xs">
              {unreadCount > 0 ? t("newMessages", { count: unreadCount }) : t("scrollToLatest")}
            </span>
          </Button>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder")}
            disabled={isSending}
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
