"""
API routes for Reviewer Intense application.
"""

import os
import hashlib
import json
from flask import Blueprint, request, jsonify, current_app

# Create API blueprint
api_bp = Blueprint('api', __name__, url_prefix='/api')


def generate_content_hash(question, answer):
    """Generates a hash based on Q/A content, used for initial ID generation."""
    q = question.strip().replace('\r\n', '\n').replace('\r', '\n')
    a = answer.strip().replace('\r\n', '\n').replace('\r', '\n')
    content = f"{q}|{a}"
    return hashlib.md5(content.encode('utf-8')).hexdigest()[:8]


def generate_random_id():
    """Generate a unique random ID with timestamp prefix to prevent collisions."""
    import time
    import secrets
    import string

    # Millisecond timestamp ensures uniqueness across different moments
    timestamp = str(int(time.time() * 1000))

    # Cryptographically secure random suffix (6 alphanumeric characters)
    # 62^6 ≈ 56 billion possible combinations
    alphabet = string.ascii_letters + string.digits  # A-Za-z0-9
    random_chars = ''.join(secrets.choice(alphabet) for _ in range(6))

    # Format: timestamp_random (e.g., "1740281234_aB3dE7")
    return f"{timestamp}_{random_chars}"


@api_bp.route('/files', methods=['GET'])
def list_files():
    """List all available JSON knowledge base files"""
    # Get KNOWLEDGE_DIR from app config
    KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

    if not os.path.exists(KNOWLEDGE_DIR):
        os.makedirs(KNOWLEDGE_DIR)
        print(f"📁 Creating directory: {KNOWLEDGE_DIR}")

    files = [f for f in os.listdir(KNOWLEDGE_DIR) if f.endswith('.json')]
    print(f"📄 Scanned {len(files)} JSON files: {files}")

    # 不再检查是否有待复习的题目，因为每次都从零开始
    file_list = []
    for f in files:
        file_list.append({
            'name': f,
            'has_due_today': True  # 始终显示为有待复习
        })

    return jsonify({"files": file_list})


@api_bp.route('/load', methods=['POST'])
def load_data():
    """Load specified knowledge base file"""
    try:
        # Get KNOWLEDGE_DIR from app config
        KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

        file_name = request.json['file_name']
        json_path = os.path.join(KNOWLEDGE_DIR, file_name)

        print(f"📖 Attempting to load file: {file_name}")

        if not os.path.exists(json_path):
             return jsonify({"error": f"Knowledge base file not found: {json_path}"}), 404

        # 读取JSON文件
        with open(json_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        if not isinstance(raw_data, list):
            raise TypeError(f"JSON format error: Root element must be a list.")

        # 处理数据，确保每个题目都有ID
        items = []
        data_modified = False

        for item in raw_data:
            question = item.get('question', '').strip()
            answer = item.get('answer', '').strip()

            if not question or not answer:
                continue

            # 生成或使用已有的ID
            existing_id = item.get('id')
            if not existing_id:
                # 为没有ID的项目生成随机ID
                stable_id = generate_random_id()
                item['id'] = stable_id  # 更新原始数据
                data_modified = True
            else:
                stable_id = existing_id

            items.append({
                'id': stable_id,
                'question': question,
                'answer': answer
            })

        # 如果有项目被修改（添加了ID），保存回文件
        if data_modified:
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(raw_data, f, ensure_ascii=False, indent=2)
            print(f"   💾 Added IDs to {len(items)} items and saved to {file_name}")

        print(f"   📊 Loaded {len(items)} items from {file_name}.")
        return jsonify({"items": items, "total": len(items)})

    except Exception as e:
        error_msg = f"Server failed to process request. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in load_data: {error_msg}")
        return jsonify({"error": error_msg}), 500


@api_bp.route('/update-item', methods=['POST'])
def update_item():
    """Update a specific item in a knowledge base file"""
    try:
        # Get KNOWLEDGE_DIR from app config
        KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

        file_name = request.json['file_name']
        item_id = request.json['item_id']
        new_question = request.json['new_question'].strip()
        new_answer = request.json['new_answer'].strip()

        if not new_question or not new_answer:
            return jsonify({"success": False, "error": "Question and answer cannot be empty"}), 400

        json_path = os.path.join(KNOWLEDGE_DIR, file_name)

        if not os.path.exists(json_path):
            return jsonify({"success": False, "error": f"Knowledge base file not found: {json_path}"}), 404

        # 读取JSON文件
        with open(json_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        if not isinstance(raw_data, list):
            return jsonify({"success": False, "error": "JSON format error: Root element must be a list."}), 400

        # 查找并更新项目
        item_found = False

        for item in raw_data:
            # 通过ID匹配，或通过内容哈希匹配（如果原始项目没有ID）
            existing_id = item.get('id')
            if existing_id == item_id:
                # 更新项目，但保持原来的ID
                item['question'] = new_question
                item['answer'] = new_answer
                item_found = True
                break
            elif not existing_id and generate_content_hash(item.get('question', ''), item.get('answer', '')) == item_id:
                # 原始项目没有ID，但内容哈希匹配
                item['question'] = new_question
                item['answer'] = new_answer
                item['id'] = item_id  # 使用原来的ID
                item_found = True
                break

        if not item_found:
            return jsonify({"success": False, "error": f"Item with ID {item_id} not found"}), 404

        # 写回文件
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(raw_data, f, ensure_ascii=False, indent=2)

        print(f"✅ Updated item in {file_name}: {item_id}")
        return jsonify({"success": True, "new_id": item_id})  # 返回原来的ID

    except Exception as e:
        error_msg = f"Server failed to update item. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in update_item: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500


@api_bp.route('/create', methods=['POST'])
def create_knowledge_base():
    """Create a new empty knowledge base file"""
    try:
        # Get KNOWLEDGE_DIR from app config
        KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

        file_name = request.json['file_name']
        # Ensure .json extension
        if not file_name.endswith('.json'):
            file_name += '.json'

        # Validate filename
        import re
        if not re.match(r'^[a-zA-Z0-9_\-\.]+$', file_name):
            return jsonify({"success": False, "error": "Invalid filename. Only letters, numbers, hyphens, underscores, and dots allowed."}), 400

        json_path = os.path.join(KNOWLEDGE_DIR, file_name)

        # Check if file already exists
        if os.path.exists(json_path):
            return jsonify({"success": False, "error": f"File already exists: {file_name}"}), 400

        # Ensure directory exists
        os.makedirs(KNOWLEDGE_DIR, exist_ok=True)

        # Create empty JSON array
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump([], f, ensure_ascii=False, indent=2)

        print(f"✅ Created new knowledge base: {file_name}")
        return jsonify({"success": True, "file_name": file_name})

    except Exception as e:
        error_msg = f"Server failed to create knowledge base. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in create_knowledge_base: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500


@api_bp.route('/save-all', methods=['POST'])
def save_all_items():
    """Save all items to a knowledge base file (overwrites existing)"""
    try:
        # Get KNOWLEDGE_DIR from app config
        KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')

        file_name = request.json['file_name']
        items = request.json['items']

        if not isinstance(items, list):
            return jsonify({"success": False, "error": "Items must be a list."}), 400

        json_path = os.path.join(KNOWLEDGE_DIR, file_name)

        # Ensure directory exists
        os.makedirs(KNOWLEDGE_DIR, exist_ok=True)

        # Process items, preserving existing IDs if they exist
        processed_items = []
        for item in items:
            question = item.get('question', '').strip()
            answer = item.get('answer', '').strip()

            if not question or not answer:
                continue  # Skip empty items

            # Use existing ID if present, otherwise generate random ID
            existing_id = item.get('id')
            if existing_id:
                item_id = existing_id
            else:
                item_id = generate_random_id()
            processed_items.append({
                'id': item_id,
                'question': question,
                'answer': answer
            })

        # Write to file
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(processed_items, f, ensure_ascii=False, indent=2)

        print(f"✅ Saved {len(processed_items)} items to {file_name}")
        return jsonify({"success": True, "count": len(processed_items)})

    except Exception as e:
        error_msg = f"Server failed to save items. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in save_all_items: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500


def get_long_term_params_path(file_name):
    """Get the path for long-term parameters file."""
    KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')
    data_dir = os.path.join(KNOWLEDGE_DIR, '.data')
    # Create data directory if it doesn't exist
    os.makedirs(data_dir, exist_ok=True)
    # Parameters file has same name as knowledge base but with _params.json suffix
    base_name = os.path.splitext(file_name)[0]
    params_file = f"{base_name}_params.json"
    return os.path.join(data_dir, params_file)


def get_daily_list_path(file_name):
    """Get the path for daily review list file."""
    KNOWLEDGE_DIR = current_app.config.get('KNOWLEDGE_DIR', 'D:\\knowledge_bases')
    data_dir = os.path.join(KNOWLEDGE_DIR, '.data')
    # Create data directory if it doesn't exist
    os.makedirs(data_dir, exist_ok=True)
    # Daily list file has same name as knowledge base but with _daily_list.json suffix
    base_name = os.path.splitext(file_name)[0]
    daily_list_file = f"{base_name}_daily_list.json"
    return os.path.join(data_dir, daily_list_file)


@api_bp.route('/load-long-term-params', methods=['POST'])
def load_long_term_params():
    """Load long-term memory parameters for a knowledge base."""
    try:
        file_name = request.json['file_name']
        params_path = get_long_term_params_path(file_name)

        if not os.path.exists(params_path):
            # Return default empty structure
            return jsonify({
                "version": "1.0",
                "last_updated": "1970-01-01",
                "cards": {}
            })

        with open(params_path, 'r', encoding='utf-8') as f:
            params_data = json.load(f)

        return jsonify(params_data)

    except Exception as e:
        error_msg = f"Failed to load long-term parameters. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in load_long_term_params: {error_msg}")
        return jsonify({"error": error_msg}), 500


@api_bp.route('/save-long-term-params', methods=['POST'])
def save_long_term_params():
    """Save long-term memory parameters for a knowledge base."""
    try:
        file_name = request.json['file_name']
        params_data = request.json['params_data']

        # Validate params_data structure
        if not isinstance(params_data, dict):
            return jsonify({"success": False, "error": "params_data must be a dictionary"}), 400

        params_path = get_long_term_params_path(file_name)

        # Add/update metadata
        from datetime import datetime
        params_data['last_updated'] = datetime.now().strftime('%Y-%m-%d')
        if 'version' not in params_data:
            params_data['version'] = "1.0"

        # Save to file
        with open(params_path, 'w', encoding='utf-8') as f:
            json.dump(params_data, f, ensure_ascii=False, indent=2)

        print(f"💾 Saved long-term parameters for {file_name}")
        return jsonify({"success": True})

    except Exception as e:
        error_msg = f"Failed to save long-term parameters. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in save_long_term_params: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500


@api_bp.route('/load-daily-list', methods=['POST'])
def load_daily_list():
    """Load daily review list for a knowledge base."""
    try:
        file_name = request.json['file_name']
        daily_list_path = get_daily_list_path(file_name)

        if not os.path.exists(daily_list_path):
            # Return empty structure if file doesn't exist
            return jsonify({
                "last_generated_date": "",
                "sequence": []
            })

        with open(daily_list_path, 'r', encoding='utf-8') as f:
            daily_list_data = json.load(f)

        return jsonify(daily_list_data)

    except Exception as e:
        error_msg = f"Failed to load daily list. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in load_daily_list: {error_msg}")
        return jsonify({"error": error_msg}), 500


@api_bp.route('/save-daily-list', methods=['POST'])
def save_daily_list():
    """Save daily review list for a knowledge base."""
    try:
        file_name = request.json['file_name']
        daily_list_data = request.json['daily_list_data']

        # Validate daily_list_data structure
        if not isinstance(daily_list_data, dict):
            return jsonify({"success": False, "error": "daily_list_data must be a dictionary"}), 400

        daily_list_path = get_daily_list_path(file_name)

        # Save to file
        with open(daily_list_path, 'w', encoding='utf-8') as f:
            json.dump(daily_list_data, f, ensure_ascii=False, indent=2)

        print(f"💾 Saved daily list for {file_name}")
        return jsonify({"success": True})

    except Exception as e:
        error_msg = f"Failed to save daily list. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in save_daily_list: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500


@api_bp.route('/load-state', methods=['POST'])
def load_state():
    """Load complete review state from server database."""
    try:
        from app.database import get_db_manager, UserStateDAO, CardStateDAO, SequenceDAO

        file_name = request.json['file_name']
        user_id = request.json.get('user_id', 'default')

        db_manager = get_db_manager()
        user_dao = UserStateDAO(db_manager)
        card_dao = CardStateDAO(db_manager)
        seq_dao = SequenceDAO(db_manager)

        # Load user state
        user_state = user_dao.get_state(user_id, file_name)
        if not user_state:
            # No state saved on server
            return jsonify({
                "exists": False,
                "message": "No saved state found on server"
            })

        # Load all cards
        cards = card_dao.get_all_cards(user_id, file_name)
        # Convert to questionMap format: card_id -> card_object
        question_map = {}
        for card in cards:
            card_id = card['card_id']
            # Convert database fields to JavaScript field names
            question_map[card_id] = {
                'id': card_id,
                '_reviewCount': card['review_count'],
                '_learningStep': card['learning_step'],
                '_mastered': bool(card['mastered']),
                '_wrongCount': card['wrong_count'],
                '_correctCount': card['correct_count'],
                '_consecutiveCorrect': card['consecutive_correct'],
                '_wrongToday': bool(card['wrong_today']),
                '_longTermN': card['long_term_n'],
                '_intervalDays': card['interval_days'],
                '_ef': card['ef'],
                '_dueDate': card['due_date'] or '',
                '_lastReviewed': card['last_reviewed'] or '',
                '_createdAt': card['created_at'] or ''
            }

        # Load sequence
        sequence = seq_dao.get_sequence(user_id, file_name)

        return jsonify({
            "exists": True,
            "userState": {
                "totalItems": user_state['total_items'],
                "masteredItems": user_state['mastered_items'],
                "isTodayCompleted": bool(user_state['is_today_completed']),
                "lastReviewDay": user_state['last_review_day'] or ''
            },
            "questionMap": question_map,
            "dynamicSequence": sequence
        })

    except Exception as e:
        error_msg = f"Failed to load state. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in load_state: {error_msg}")
        return jsonify({"error": error_msg}), 500


@api_bp.route('/save-state', methods=['POST'])
def save_state():
    """Save complete review state to server database."""
    try:
        from app.database import get_db_manager, UserStateDAO, CardStateDAO, SequenceDAO

        file_name = request.json['file_name']
        user_id = request.json.get('user_id', 'default')
        user_state = request.json.get('userState', {})
        question_map = request.json.get('questionMap', {})
        dynamic_sequence = request.json.get('dynamicSequence', [])

        db_manager = get_db_manager()
        user_dao = UserStateDAO(db_manager)
        card_dao = CardStateDAO(db_manager)
        seq_dao = SequenceDAO(db_manager)

        # Save user state
        user_dao.save_state(user_id, file_name, {
            "total_items": user_state.get("totalItems", 0),
            "mastered_items": user_state.get("masteredItems", 0),
            "is_today_completed": user_state.get("isTodayCompleted", False),
            "last_review_day": user_state.get("lastReviewDay")
        })

        # Prepare card data for batch save
        cards_data = {}
        for card_id, card_obj in question_map.items():
            cards_data[card_id] = {
                "review_count": card_obj.get("_reviewCount", 0),
                "learning_step": card_obj.get("_learningStep", 0),
                "mastered": card_obj.get("_mastered", False),
                "wrong_count": card_obj.get("_wrongCount", 0),
                "correct_count": card_obj.get("_correctCount", 0),
                "consecutive_correct": card_obj.get("_consecutiveCorrect", 0),
                "wrong_today": card_obj.get("_wrongToday", False),
                "long_term_n": card_obj.get("_longTermN", 0),
                "interval_days": card_obj.get("_intervalDays", 1),
                "ef": card_obj.get("_ef", 2.5),
                "due_date": card_obj.get("_dueDate") or None,
                "last_reviewed": card_obj.get("_lastReviewed") or None,
                "created_at": card_obj.get("_createdAt") or None
            }

        # Save all cards
        if cards_data:
            card_dao.save_batch_cards(user_id, file_name, cards_data)

        # Save sequence
        seq_dao.save_sequence(user_id, file_name, dynamic_sequence)

        return jsonify({"success": True, "message": "State saved successfully"})

    except Exception as e:
        error_msg = f"Failed to save state. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in save_state: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500


@api_bp.route('/migrate-from-localstorage', methods=['POST'])
def migrate_from_localstorage():
    """Migrate progress data from localStorage to server database."""
    try:
        from app.database import get_db_manager, UserStateDAO, CardStateDAO, SequenceDAO

        file_name = request.json['file_name']
        user_id = request.json.get('user_id', 'default')
        localStorage_data = request.json.get('localStorageData', {})

        if not localStorage_data:
            return jsonify({"success": False, "error": "No localStorage data provided"}), 400

        # Parse localStorage data structure
        question_map_entries = localStorage_data.get('questionMap', [])
        dynamic_sequence = localStorage_data.get('dynamicSequence', [])
        mastered_items = localStorage_data.get('masteredItems', 0)
        total_items = localStorage_data.get('totalItems', 0)

        # Convert questionMap from entries array to dict
        question_map = {}
        for entry in question_map_entries:
            if len(entry) >= 2:
                card_id = entry[0]
                card_obj = entry[1]
                question_map[card_id] = card_obj

        db_manager = get_db_manager()
        user_dao = UserStateDAO(db_manager)
        card_dao = CardStateDAO(db_manager)
        seq_dao = SequenceDAO(db_manager)

        # Save user state
        user_dao.save_state(user_id, file_name, {
            "total_items": total_items,
            "mastered_items": mastered_items,
            "is_today_completed": False,  # 迁移时默认未完成
            "last_review_day": ""  # 迁移时不设置最后复习日
        })

        # Prepare card data for batch save
        cards_data = {}
        for card_id, card_obj in question_map.items():
            cards_data[card_id] = {
                "review_count": card_obj.get("_reviewCount", 0),
                "learning_step": card_obj.get("_learningStep", 0),
                "mastered": card_obj.get("_mastered", False),
                "wrong_count": card_obj.get("_wrongCount", 0),
                "correct_count": card_obj.get("_correctCount", 0),
                "consecutive_correct": card_obj.get("_consecutiveCorrect", 0),
                "wrong_today": card_obj.get("_wrongToday", False),
                "long_term_n": card_obj.get("_longTermN", 0),
                "interval_days": card_obj.get("_intervalDays", 1),
                "ef": card_obj.get("_ef", 2.5),
                "due_date": card_obj.get("_dueDate") or None,
                "last_reviewed": card_obj.get("_lastReviewed") or None,
                "created_at": card_obj.get("_createdAt") or None
            }

        # Save all cards
        if cards_data:
            card_dao.save_batch_cards(user_id, file_name, cards_data)

        # Save sequence
        seq_dao.save_sequence(user_id, file_name, dynamic_sequence)

        return jsonify({
            "success": True,
            "message": f"Migrated {len(cards_data)} cards and {len(dynamic_sequence)} sequence items"
        })

    except Exception as e:
        error_msg = f"Failed to migrate data. File: {request.json.get('file_name', 'N/A')}. Details: {type(e).__name__}: {str(e)}"
        print(f"Server Error in migrate_from_localstorage: {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500