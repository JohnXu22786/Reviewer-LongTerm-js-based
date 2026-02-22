"""
数据库模块 - 管理SQLite数据库连接和表结构
为reviewer-intense项目提供服务器端状态存储
"""

import sqlite3
import json
import threading
import logging
from datetime import datetime, date
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


class DatabaseManager:
    """数据库管理器单例类"""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super(DatabaseManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self, db_path: Optional[str] = None):
        if not self._initialized:
            self.db_path = db_path or "reviewer_state.db"
            self.conn = None
            self._initialize_database()
            self._initialized = True

    def get_connection(self) -> sqlite3.Connection:
        """获取数据库连接"""
        if self.conn is None:
            self.conn = sqlite3.connect(
                self.db_path,
                check_same_thread=False,
                isolation_level=None
            )
            self.conn.row_factory = sqlite3.Row
            # 启用外键约束
            self.conn.execute("PRAGMA foreign_keys = ON")
        return self.conn

    def _initialize_database(self):
        """初始化数据库表结构"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # 用户状态表
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_states (
            user_id TEXT DEFAULT 'default',
            file_name TEXT NOT NULL,
            total_items INTEGER DEFAULT 0,
            mastered_items INTEGER DEFAULT 0,
            is_today_completed BOOLEAN DEFAULT FALSE,
            last_review_day TEXT, -- 存储为YYYY-MM-DD格式
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, file_name)
        )
        ''')

        # 卡片状态表
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS card_states (
            user_id TEXT DEFAULT 'default',
            file_name TEXT NOT NULL,
            card_id TEXT NOT NULL,
            review_count INTEGER DEFAULT 0,
            learning_step INTEGER DEFAULT 0,
            mastered BOOLEAN DEFAULT FALSE,
            wrong_count INTEGER DEFAULT 0,
            correct_count INTEGER DEFAULT 0,
            consecutive_correct INTEGER DEFAULT 0,
            wrong_today BOOLEAN DEFAULT FALSE,
            long_term_n INTEGER DEFAULT 0,
            interval_days INTEGER DEFAULT 1,
            ef REAL DEFAULT 2.5,
            due_date TEXT, -- 存储为YYYY-MM-DD格式
            last_reviewed TEXT, -- 存储为YYYY-MM-DD格式
            created_at TEXT, -- 存储为YYYY-MM-DD格式
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, file_name, card_id)
        )
        ''')

        # 动态序列表
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS dynamic_sequences (
            user_id TEXT DEFAULT 'default',
            file_name TEXT NOT NULL,
            sequence_index INTEGER NOT NULL,
            card_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, file_name, sequence_index)
        )
        ''')

        # 每日列表快照表
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS daily_list_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT DEFAULT 'default',
            file_name TEXT NOT NULL,
            snapshot_date TEXT NOT NULL, -- 存储为YYYY-MM-DD格式
            sequence_data TEXT NOT NULL, -- JSON数组
            total_cards INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')

        # 创建索引以提高查询性能
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_card_states_user_file ON card_states(user_id, file_name)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_card_states_due_date ON card_states(due_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sequences_user_file ON dynamic_sequences(user_id, file_name)')

        conn.commit()
        logger.info(f"数据库初始化完成: {self.db_path}")

    def close(self):
        """关闭数据库连接"""
        if self.conn:
            self.conn.close()
            self.conn = None
            logger.info("数据库连接已关闭")

    def reset_database(self):
        """重置数据库（用于测试）"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("DROP TABLE IF EXISTS daily_list_snapshots")
        cursor.execute("DROP TABLE IF EXISTS dynamic_sequences")
        cursor.execute("DROP TABLE IF EXISTS card_states")
        cursor.execute("DROP TABLE IF EXISTS user_states")
        conn.commit()
        self._initialize_database()
        logger.info("数据库已重置")


class UserStateDAO:
    """用户状态数据访问对象"""

    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager

    def get_state(self, user_id: str = "default", file_name: str = "") -> Optional[Dict]:
        """获取用户状态"""
        if not file_name:
            return None

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM user_states WHERE user_id = ? AND file_name = ?",
            (user_id, file_name)
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def save_state(self, user_id: str = "default", file_name: str = "", state_data: Dict = None):
        """保存或更新用户状态"""
        if not file_name or not state_data:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()

        # 检查是否存在
        cursor.execute(
            "SELECT 1 FROM user_states WHERE user_id = ? AND file_name = ?",
            (user_id, file_name)
        )
        exists = cursor.fetchone() is not None

        now = datetime.now().isoformat()

        if exists:
            # 更新
            cursor.execute('''
            UPDATE user_states
            SET total_items = ?, mastered_items = ?, is_today_completed = ?,
                last_review_day = ?, updated_at = ?
            WHERE user_id = ? AND file_name = ?
            ''', (
                state_data.get("total_items", 0),
                state_data.get("mastered_items", 0),
                state_data.get("is_today_completed", False),
                state_data.get("last_review_day"),
                now,
                user_id,
                file_name
            ))
        else:
            # 插入
            cursor.execute('''
            INSERT INTO user_states
            (user_id, file_name, total_items, mastered_items, is_today_completed, last_review_day, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_id,
                file_name,
                state_data.get("total_items", 0),
                state_data.get("mastered_items", 0),
                state_data.get("is_today_completed", False),
                state_data.get("last_review_day"),
                now
            ))

        conn.commit()
        return True

    def delete_state(self, user_id: str = "default", file_name: str = "") -> bool:
        """删除用户状态（级联删除相关卡片状态和序列）"""
        if not file_name:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM user_states WHERE user_id = ? AND file_name = ?",
            (user_id, file_name)
        )
        conn.commit()
        return cursor.rowcount > 0


class CardStateDAO:
    """卡片状态数据访问对象"""

    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager

    def get_card(self, user_id: str = "default", file_name: str = "", card_id: str = "") -> Optional[Dict]:
        """获取单个卡片状态"""
        if not file_name or not card_id:
            return None

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT * FROM card_states
               WHERE user_id = ? AND file_name = ? AND card_id = ?""",
            (user_id, file_name, card_id)
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_all_cards(self, user_id: str = "default", file_name: str = "") -> List[Dict]:
        """获取知识库所有卡片状态"""
        if not file_name:
            return []

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT * FROM card_states
               WHERE user_id = ? AND file_name = ?
               ORDER BY card_id""",
            (user_id, file_name)
        )
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def save_card(self, user_id: str = "default", file_name: str = "",
                 card_id: str = "", card_data: Dict = None) -> bool:
        """保存或更新卡片状态"""
        if not file_name or not card_id or not card_data:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()

        # 检查是否存在
        cursor.execute(
            """SELECT 1 FROM card_states
               WHERE user_id = ? AND file_name = ? AND card_id = ?""",
            (user_id, file_name, card_id)
        )
        exists = cursor.fetchone() is not None

        now = datetime.now().isoformat()

        if exists:
            # 更新
            cursor.execute('''
            UPDATE card_states
            SET review_count = ?, learning_step = ?, mastered = ?, wrong_count = ?,
                correct_count = ?, consecutive_correct = ?, wrong_today = ?,
                long_term_n = ?, interval_days = ?, ef = ?, due_date = ?,
                last_reviewed = ?, created_at = ?, updated_at = ?
            WHERE user_id = ? AND file_name = ? AND card_id = ?
            ''', (
                card_data.get("review_count", 0),
                card_data.get("learning_step", 0),
                card_data.get("mastered", False),
                card_data.get("wrong_count", 0),
                card_data.get("correct_count", 0),
                card_data.get("consecutive_correct", 0),
                card_data.get("wrong_today", False),
                card_data.get("long_term_n", 0),
                card_data.get("interval_days", 1),
                card_data.get("ef", 2.5),
                card_data.get("due_date"),
                card_data.get("last_reviewed"),
                card_data.get("created_at"),
                now,
                user_id,
                file_name,
                card_id
            ))
        else:
            # 插入
            cursor.execute('''
            INSERT INTO card_states
            (user_id, file_name, card_id, review_count, learning_step, mastered,
             wrong_count, correct_count, consecutive_correct, wrong_today,
             long_term_n, interval_days, ef, due_date, last_reviewed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_id,
                file_name,
                card_id,
                card_data.get("review_count", 0),
                card_data.get("learning_step", 0),
                card_data.get("mastered", False),
                card_data.get("wrong_count", 0),
                card_data.get("correct_count", 0),
                card_data.get("consecutive_correct", 0),
                card_data.get("wrong_today", False),
                card_data.get("long_term_n", 0),
                card_data.get("interval_days", 1),
                card_data.get("ef", 2.5),
                card_data.get("due_date"),
                card_data.get("last_reviewed"),
                card_data.get("created_at"),
                now
            ))

        conn.commit()
        return True

    def save_batch_cards(self, user_id: str = "default", file_name: str = "",
                        cards_data: Dict[str, Dict] = None) -> bool:
        """批量保存卡片状态"""
        if not file_name or not cards_data:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()

        try:
            for card_id, card_data in cards_data.items():
                # 检查是否存在
                cursor.execute(
                    """SELECT 1 FROM card_states
                       WHERE user_id = ? AND file_name = ? AND card_id = ?""",
                    (user_id, file_name, card_id)
                )
                exists = cursor.fetchone() is not None

                now = datetime.now().isoformat()

                if exists:
                    # 更新
                    cursor.execute('''
                    UPDATE card_states
                    SET review_count = ?, learning_step = ?, mastered = ?, wrong_count = ?,
                        correct_count = ?, consecutive_correct = ?, wrong_today = ?,
                        long_term_n = ?, interval_days = ?, ef = ?, due_date = ?,
                        last_reviewed = ?, created_at = ?, updated_at = ?
                    WHERE user_id = ? AND file_name = ? AND card_id = ?
                    ''', (
                        card_data.get("review_count", 0),
                        card_data.get("learning_step", 0),
                        card_data.get("mastered", False),
                        card_data.get("wrong_count", 0),
                        card_data.get("correct_count", 0),
                        card_data.get("consecutive_correct", 0),
                        card_data.get("wrong_today", False),
                        card_data.get("long_term_n", 0),
                        card_data.get("interval_days", 1),
                        card_data.get("ef", 2.5),
                        card_data.get("due_date"),
                        card_data.get("last_reviewed"),
                        card_data.get("created_at"),
                        now,
                        user_id,
                        file_name,
                        card_id
                    ))
                else:
                    # 插入
                    cursor.execute('''
                    INSERT INTO card_states
                    (user_id, file_name, card_id, review_count, learning_step, mastered,
                     wrong_count, correct_count, consecutive_correct, wrong_today,
                     long_term_n, interval_days, ef, due_date, last_reviewed, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        user_id,
                        file_name,
                        card_id,
                        card_data.get("review_count", 0),
                        card_data.get("learning_step", 0),
                        card_data.get("mastered", False),
                        card_data.get("wrong_count", 0),
                        card_data.get("correct_count", 0),
                        card_data.get("consecutive_correct", 0),
                        card_data.get("wrong_today", False),
                        card_data.get("long_term_n", 0),
                        card_data.get("interval_days", 1),
                        card_data.get("ef", 2.5),
                        card_data.get("due_date"),
                        card_data.get("last_reviewed"),
                        card_data.get("created_at"),
                        now
                    ))

            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            logger.error(f"批量保存卡片失败: {e}")
            return False

    def delete_card(self, user_id: str = "default", file_name: str = "",
                   card_id: str = "") -> bool:
        """删除卡片状态"""
        if not file_name or not card_id:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """DELETE FROM card_states
               WHERE user_id = ? AND file_name = ? AND card_id = ?""",
            (user_id, file_name, card_id)
        )
        conn.commit()
        return cursor.rowcount > 0

    def delete_all_cards(self, user_id: str = "default", file_name: str = "") -> bool:
        """删除知识库所有卡片状态"""
        if not file_name:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """DELETE FROM card_states WHERE user_id = ? AND file_name = ?""",
            (user_id, file_name)
        )
        conn.commit()
        return cursor.rowcount > 0


class SequenceDAO:
    """动态序列数据访问对象"""

    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager

    def get_sequence(self, user_id: str = "default", file_name: str = "") -> List[str]:
        """获取动态序列（按顺序返回卡片ID列表）"""
        if not file_name:
            return []

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT card_id FROM dynamic_sequences
               WHERE user_id = ? AND file_name = ?
               ORDER BY sequence_index""",
            (user_id, file_name)
        )
        rows = cursor.fetchall()
        return [row["card_id"] for row in rows]

    def save_sequence(self, user_id: str = "default", file_name: str = "",
                     sequence: List[str] = None) -> bool:
        """保存动态序列（替换现有序列）"""
        if not file_name:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()

        try:
            # 删除现有序列
            cursor.execute(
                """DELETE FROM dynamic_sequences
                   WHERE user_id = ? AND file_name = ?""",
                (user_id, file_name)
            )

            # 插入新序列
            for index, card_id in enumerate(sequence or []):
                cursor.execute(
                    """INSERT INTO dynamic_sequences
                       (user_id, file_name, sequence_index, card_id)
                       VALUES (?, ?, ?, ?)""",
                    (user_id, file_name, index, card_id)
                )

            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            logger.error(f"保存序列失败: {e}")
            return False

    def clear_sequence(self, user_id: str = "default", file_name: str = "") -> bool:
        """清空动态序列"""
        if not file_name:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """DELETE FROM dynamic_sequences WHERE user_id = ? AND file_name = ?""",
            (user_id, file_name)
        )
        conn.commit()
        return cursor.rowcount > 0


class SnapshotDAO:
    """每日快照数据访问对象"""

    def __init__(self, db_manager: DatabaseManager):
        self.db = db_manager

    def save_snapshot(self, user_id: str = "default", file_name: str = "",
                     snapshot_date: str = "", sequence: List[str] = None) -> bool:
        """保存每日快照"""
        if not file_name or not snapshot_date:
            return False

        conn = self.db.get_connection()
        cursor = conn.cursor()

        try:
            sequence_json = json.dumps(sequence or [])
            cursor.execute('''
            INSERT INTO daily_list_snapshots
            (user_id, file_name, snapshot_date, sequence_data, total_cards)
            VALUES (?, ?, ?, ?, ?)
            ''', (
                user_id,
                file_name,
                snapshot_date,
                sequence_json,
                len(sequence or [])
            ))

            conn.commit()
            return True
        except Exception as e:
            conn.rollback()
            logger.error(f"保存快照失败: {e}")
            return False

    def get_snapshot(self, user_id: str = "default", file_name: str = "",
                    snapshot_date: str = "") -> Optional[Dict]:
        """获取指定日期的快照"""
        if not file_name or not snapshot_date:
            return None

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT * FROM daily_list_snapshots
               WHERE user_id = ? AND file_name = ? AND snapshot_date = ?""",
            (user_id, file_name, snapshot_date)
        )
        row = cursor.fetchone()

        if row:
            result = dict(row)
            result["sequence"] = json.loads(result["sequence_data"])
            return result
        return None

    def get_recent_snapshots(self, user_id: str = "default", file_name: str = "",
                           limit: int = 10) -> List[Dict]:
        """获取最近的快照"""
        if not file_name:
            return []

        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT * FROM daily_list_snapshots
               WHERE user_id = ? AND file_name = ?
               ORDER BY snapshot_date DESC LIMIT ?""",
            (user_id, file_name, limit)
        )
        rows = cursor.fetchall()

        results = []
        for row in rows:
            result = dict(row)
            result["sequence"] = json.loads(result["sequence_data"])
            results.append(result)

        return results


# 全局数据库管理器实例
_db_manager = None

def get_db_manager(db_path: Optional[str] = None) -> DatabaseManager:
    """获取全局数据库管理器实例"""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager(db_path)
    return _db_manager

def init_database(db_path: Optional[str] = None):
    """初始化数据库（应用启动时调用）"""
    get_db_manager(db_path)
    logger.info("数据库初始化完成")

def close_database():
    """关闭数据库连接（应用关闭时调用）"""
    global _db_manager
    if _db_manager:
        _db_manager.close()
        _db_manager = None