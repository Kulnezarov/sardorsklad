from typing import List, Optional, TypeVar, Generic
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import select, and_, or_
from models import Base

ModelType = TypeVar("ModelType", bound=Base)

class BaseRepository(Generic[ModelType]):
    """
    Base repository with common CRUD operations and optimization patterns.
    """
    
    def __init__(self, model: type[ModelType], db: Session):
        self.model = model
        self.db = db
    
    def get(self, id: int) -> Optional[ModelType]:
        """Get single record by ID."""
        return self.db.query(self.model).filter(self.model.id == id).first()
    
    def get_multi(
        self, 
        skip: int = 0, 
        limit: int = 100,
        load_relations: Optional[List[str]] = None
    ) -> List[ModelType]:
        """
        Get multiple records with optional relationship loading.
        
        Args:
            skip: Number of records to skip
            limit: Maximum number of records to return
            load_relations: List of relationship names to preload
        """
        query = self.db.query(self.model)
        
        # Optimize by preloading relationships to avoid N+1 problems
        if load_relations:
            for relation in load_relations:
                if hasattr(self.model, relation):
                    query = query.options(joinedload(getattr(self.model, relation)))
        
        return query.offset(skip).limit(limit).all()
    
    def get_with_relations(
        self,
        relations: List[str],
        id: Optional[int] = None
    ) -> Optional[ModelType]:
        """
        Get record with specified relationships preloaded.
        
        Args:
            relations: List of relationship names to preload
            id: Optional ID filter
        """
        query = self.db.query(self.model)
        
        # Use joinedload for single relationships
        # Use selectinload for collection relationships
        for relation in relations:
            if hasattr(self.model, relation):
                attr = getattr(self.model, relation)
                # Determine if it's a collection or single relationship
                if attr.property.uselist:
                    query = query.options(selectinload(attr))
                else:
                    query = query.options(joinedload(attr))
        
        if id is not None:
            query = query.filter(self.model.id == id)
            return query.first()
        
        return query.all()
    
    def create(self, obj_in: dict) -> ModelType:
        """Create new record."""
        db_obj = self.model(**obj_in)
        self.db.add(db_obj)
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj
    
    def update(self, db_obj: ModelType, obj_in: dict) -> ModelType:
        """Update existing record."""
        for field, value in obj_in.items():
            if hasattr(db_obj, field):
                setattr(db_obj, field, value)
        
        self.db.commit()
        self.db.refresh(db_obj)
        return db_obj
    
    def delete(self, id: int) -> ModelType:
        """Delete record by ID."""
        obj = self.get(id)
        if obj:
            self.db.delete(obj)
            self.db.commit()
        return obj
    
    def count(self) -> int:
        """Count total records."""
        return self.db.query(self.model).count()
    
    def search(
        self,
        search_term: str,
        search_fields: List[str],
        skip: int = 0,
        limit: int = 100
    ) -> List[ModelType]:
        """
        Search records across multiple fields.
        
        Args:
            search_term: Term to search for
            search_fields: List of field names to search in
            skip: Number of records to skip
            limit: Maximum number of records to return
        """
        if not search_term:
            return self.get_multi(skip=skip, limit=limit)
        
        # Build search conditions
        conditions = []
        for field in search_fields:
            if hasattr(self.model, field):
                field_attr = getattr(self.model, field)
                conditions.append(field_attr.ilike(f"%{search_term}%"))
        
        query = self.db.query(self.model)
        if conditions:
            query = query.filter(or_(*conditions))
        
        return query.offset(skip).limit(limit).all()
